DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'apppass';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE appdb TO app_user;