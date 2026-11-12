# PostgreSQL

PostgreSQL syntax highlighting, snippets, keyword completion, and signature help for `.pgsql` files. Run the current file with `psql`.

Maintained by che-11. Based on [postgresql](https://marketplace.visualstudio.com/items?itemName=JPTarquino.postgresql) by [JPTarquino](https://github.com/jptarqu/VSCodeExtension-PostgreSQL). Syntax highlighting converted from [postgres.tmbundle](https://github.com/mulander/postgres.tmbundle) by mulander.

Function descriptions are taken from the [PostgreSQL 9.5 documentation](https://www.postgresql.org/docs/9.5/functions.html).

## Run a file

`psql` must be on your PATH. Set the connection, then run **Postgres: Execute File in Server**.

| Setting | Default | Meaning |
| --- | --- | --- |
| `postgreSql.hostName` | `localhost` | Server host |
| `postgreSql.username` | `postgres` | User name |
| `postgreSql.dbName` | `postgres` | Database name |

Output, including `psql` errors, is written to the **psql** channel.

## Development

`pnpm run compile` typechecks the extension. `pnpm run package` writes `builds/ce-postgresql-<version>.vsix`.
