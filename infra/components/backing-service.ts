import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

export interface BackingServiceArgs {
  namespace: pulumi.Input<string>;
  image: string;
  port: number;
  env?: k8s.types.input.core.v1.EnvVar[];
  readinessCommand: string[];
  memoryLimit: string;
}

export class BackingService extends pulumi.ComponentResource {
  public readonly host: pulumi.Output<string>;

  constructor(name: string, args: BackingServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super('rd-course:index:BackingService', name, {}, opts);

    const labels = { app: name, part: 'backing' };

    const deployment = new k8s.apps.v1.Deployment(name, {
      metadata: { name, namespace: args.namespace, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [{
              name,
              image: args.image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ containerPort: args.port }],
              env: args.env,
              readinessProbe: {
                exec: { command: args.readinessCommand },
                periodSeconds: 2,
                failureThreshold: 3,
              },
              resources: {
                requests: { cpu: '20m', memory: '32Mi' },
                limits: { memory: args.memoryLimit },
              },
            }],
          },
        },
      },
    }, { parent: this });

    const service = new k8s.core.v1.Service(name, {
      metadata: { name, namespace: args.namespace, labels },
      spec: { selector: labels, ports: [{ port: args.port, targetPort: args.port }] },
    }, { parent: this, dependsOn: [deployment] });

    this.host = service.metadata.name;
    this.registerOutputs({ host: this.host });
  }
}