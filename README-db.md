# Database Run & Passwordless Setup

## Start PostgreSQL (existing data dir)
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" start -D "C:\PostgresDataClean" -l "C:\PostgresDataClean\server.log"
```

## Ensure IPv4 listening
Edit `C:\PostgresDataClean\postgresql.conf` and set:
```
listen_addresses = 'localhost'
```
Then restart:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" restart -D "C:\PostgresDataClean"
```

## Test connection
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" "postgresql://skills_user:changeme@localhost:5432/skillsupslovakia" -c "SELECT current_user, current_database();"
```

## Password prompt avoidance (.pgpass)
Create `%APPDATA%\postgresql\pgpass.conf` with lines:
```
localhost:5432:skillsupslovakia:skills_user:changeme
localhost:5432:postgres:postgres:5067899534
```
Restart shell and psql will not prompt for those entries.

## Start app
```powershell
npm start
```
The start script waits until DB is reachable.
