import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

import { BackingService } from './components/backing-service';
import { loadVaultValues, VAULT_VARIABLES } from './config';

const vault = loadVaultValues();

const config = new pulumi.Config();
const kubeContext = config.require('kubeContext');
const namespaceName = config.require('namespace');
const image = config.require('image');
const replicas = config.requireNumber('replicas');
const profile = config.require('profile');
const rev = config.require('rev');
const nodePort = config.requireNumber('nodePort');

if (profile !== 'good' && profile !== 'bad') throw new Error(`profile must be "good" or "bad", got "${profile}"`);

const hardened = profile === 'good';
const drainMs = hardened ? 8000 : 0;
const appPort = 3000;
const secretName = 'api-secrets';
const dbUser = 'app';
const dbName = 'appdb';

const provider = new k8s.Provider('kind', { context: kubeContext });
const opts = { provider };

const namespace = new k8s.core.v1.Namespace(namespaceName, { metadata: { name: namespaceName } }, opts);

const secret = new k8s.core.v1.Secret(secretName, {
  metadata: { name: secretName, namespace: namespace.metadata.name },
  type: 'Opaque',
  data: Object.fromEntries(
    VAULT_VARIABLES.map((name) => [name, pulumi.secret(Buffer.from(vault[name]).toString('base64'))]),
  ),
}, opts);

const fromSecret = (name: string, key: string): k8s.types.input.core.v1.EnvVar => ({
  name,
  valueFrom: { secretKeyRef: { name: secret.metadata.name, key } },
});

const postgres = new BackingService('postgres', {
  namespace: namespace.metadata.name,
  image: 'postgres:17',
  port: 5432,
  env: [
    { name: 'POSTGRES_USER', value: dbUser },
    { name: 'POSTGRES_DB', value: dbName },
    fromSecret('POSTGRES_PASSWORD', 'PGPASSWORD'),
  ],
  readinessCommand: ['pg_isready', '-U', dbUser, '-d', dbName],
  memoryLimit: '256Mi',
}, opts);

const redis = new BackingService('redis', {
  namespace: namespace.metadata.name,
  image: 'redis:7-alpine',
  port: 6379,
  readinessCommand: ['redis-cli', 'ping'],
  memoryLimit: '64Mi',
}, opts);

const labels = { app: 'api' };

const deployment = new k8s.apps.v1.Deployment('api', {
  metadata: { name: 'api', namespace: namespace.metadata.name, labels },
  spec: {
    replicas,
    selector: { matchLabels: labels },
    strategy: {
      type: 'RollingUpdate',
      rollingUpdate: hardened ? { maxUnavailable: 0, maxSurge: 1 } : { maxUnavailable: 1, maxSurge: 1 },
    },
    template: {
      metadata: { labels },
      spec: {
        terminationGracePeriodSeconds: hardened ? 20 : 30,
        securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532 },
        containers: [{
          name: 'api',
          image,
          imagePullPolicy: 'IfNotPresent',
          ports: [{ containerPort: appPort }],
          env: [
            { name: 'NODE_ENV', value: 'production' },
            { name: 'PORT', value: String(appPort) },
            { name: 'WARMUP_MS', value: '4000' },
            { name: 'DRAIN_MS', value: String(drainMs) },
            { name: 'REV', value: rev },
            { name: 'PGHOST', value: postgres.host },
            { name: 'PGPORT', value: '5432' },
            { name: 'PGUSER', value: dbUser },
            { name: 'PGDATABASE', value: dbName },
            { name: 'REDIS_URL', value: pulumi.interpolate`redis://${redis.host}:6379` },
            { name: 'REDIS_QUEUE_URL', value: pulumi.interpolate`redis://${redis.host}:6379` },
            fromSecret('PGPASSWORD', 'PGPASSWORD'),
            fromSecret('JWT_PRIVATE_KEY', 'JWT_PRIVATE_KEY'),
            fromSecret('JWT_PUBLIC_KEY', 'JWT_PUBLIC_KEY'),
            fromSecret('JWT_KID', 'JWT_KID'),
            fromSecret('REFRESH_TOKEN_PEPPER', 'REFRESH_TOKEN_PEPPER'),
          ],
          resources: {
            requests: { cpu: '50m', memory: '96Mi' },
            limits: { memory: '256Mi' },
          },
          ...(hardened
            ? {
                readinessProbe: {
                  httpGet: { path: '/readyz', port: appPort },
                  periodSeconds: 1,
                  failureThreshold: 1,
                },
                livenessProbe: {
                  httpGet: { path: '/healthz', port: appPort },
                  initialDelaySeconds: 15,
                  periodSeconds: 10,
                  failureThreshold: 3,
                },
              }
            : {}),
        }],
      },
    },
  },
}, { ...opts, dependsOn: [postgres, redis] });

const service = new k8s.core.v1.Service('api', {
  metadata: { name: 'api', namespace: namespace.metadata.name, labels },
  spec: {
    type: 'NodePort',
    selector: labels,
    ports: [{ port: 80, targetPort: appPort, nodePort }],
  },
}, { ...opts, dependsOn: [deployment] });

const pdb = new k8s.policy.v1.PodDisruptionBudget('api', {
  metadata: { name: 'api', namespace: namespace.metadata.name, labels },
  spec: { minAvailable: Math.max(replicas - 1, 1), selector: { matchLabels: labels } },
}, opts);

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler('api', {
  metadata: { name: 'api', namespace: namespace.metadata.name, labels },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment.metadata.name },
    minReplicas: 2,
    maxReplicas: 5,
    metrics: [{
      type: 'Resource',
      resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } },
    }],
  },
}, opts);

export const activeProfile = profile;
export const revision = rev;
export const namespaceOut = namespace.metadata.name;
export const deploymentName = deployment.metadata.name;
export const serviceNodePort = service.spec.ports[0].nodePort;
export const pdbName = pdb.metadata.name;
export const hpaName = hpa.metadata.name;
