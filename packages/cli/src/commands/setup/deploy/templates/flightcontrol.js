export const flightcontrolConfig = {
  $schema: 'https://app.flightcontrol.dev/schema.json',
  environments: [
    {
      id: 'development',
      name: 'Development',
      region: 'us-east-1',
      source: {
        branch: 'main',
      },
      services: [
        {
          id: 'cedar-api',
          name: 'Cedar API',
          type: 'web',
          buildType: 'nixpacks',
          cpu: 0.5,
          memory: 1,
          buildCommand: 'yarn cedar deploy flightcontrol api',
          startCommand: 'yarn cedar deploy flightcontrol api --serve',
          port: 8911,
          healthCheckPath: '/graphql/health',
          ci: {
            type: 'ec2',
          },
          envVariables: {
            CEDAR_WEB_URL: {
              fromService: { id: 'cedar-web', value: 'origin' },
            },
          },
        },
        {
          id: 'cedar-web',
          name: 'Cedar Web',
          type: 'static',
          buildType: 'nixpacks',
          singlePageApp: true,
          buildCommand: 'yarn cedar deploy flightcontrol web',
          outputDirectory: 'web/dist',
          ci: {
            type: 'ec2',
          },
          envVariables: {
            CEDAR_API_URL: {
              fromService: { id: 'cedar-api', value: 'origin' },
            },
          },
        },
      ],
    },
  ],
}

export const postgresDatabaseService = {
  id: 'db',
  name: 'Database',
  type: 'rds',
  engine: 'postgres',
  engineVersion: '16',
  instanceSize: 'db.t4g.micro',
  port: 5432,
  storage: 20,
  private: false,
}

export const mysqlDatabaseService = {
  id: 'db',
  name: 'Mysql',
  type: 'rds',
  engine: 'mysql',
  engineVersion: '8',
  instanceSize: 'db.t4g.micro',
  port: 3306,
  storage: 20,
  private: false,
}

export const databaseEnvVariables = {
  DATABASE_URL: {
    fromService: { id: 'db', value: 'dbConnectionString' },
  },
}
