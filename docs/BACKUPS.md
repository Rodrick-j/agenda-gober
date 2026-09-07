# Backups de la base de datos

Estado: **inicial / local**. Suficiente para no perder datos en desarrollo y
como primer paso hacia producción; todavía falta la copia fuera de la máquina
(ver "Pendiente" al final).

## Qué hay

| Script | Qué hace |
|---|---|
| `scripts/backup.sh` | `pg_dump -Fc` de `agenda_gober` + `pg_dumpall --roles-only` + `sha256`. Deja todo en `./backups/` (ignorado por git). Conserva los últimos **14** (`BACKUP_KEEP` para cambiarlo). |
| `scripts/restore.sh` | Restaura un backup en una base **de prueba** (`agenda_gober_restore_test`), verifica el checksum y corre consultas de control. La base real no se toca salvo que pases `--into-main`. |

El dump sale por el socket unix del contenedor (`docker compose exec`), así
que no necesita TLS ni contraseña.

## Uso diario

```bash
# Crear un backup
bash scripts/backup.sh

# Probar que el último backup restaura bien (recomendado hacerlo seguido)
bash scripts/restore.sh latest
# -> "RESTORE OK", muestra nº de migraciones, secretarías, usuarios, etc.

# Restaurar de verdad, encima de la base real (recuperación ante desastre):
bash scripts/restore.sh latest --into-main      # pide escribir "restaurar"
bash scripts/restore.sh backups/agenda_gober_2026-09-06_....dump --into-main
```

Formato **custom** (`-Fc`): comprimido, y `pg_restore` permite restaurar en
paralelo o solo una tabla si hiciera falta.

## Programarlo (Windows, Git Bash)

Task Scheduler, todos los días a las 02:30:

```bat
schtasks /Create /SC DAILY /ST 02:30 /TN "AGENDA.GOBER backup" /F ^
  /TR "\"C:\Program Files\Git\bin\bash.exe\" -lc \"cd /c/Users/stard/OneDrive/Desktop/AGENDA.GOBER && bash scripts/backup.sh >> backups/backup.log 2>&1\""
```

En Linux/WSL sería una línea de `crontab -e`:
`30 2 * * * cd /ruta/AGENDA.GOBER && bash scripts/backup.sh >> backups/backup.log 2>&1`

> El backup **no** va dentro del proceso de la API (`@nestjs/schedule`) a
> propósito: la imagen de la API no trae `pg_dump`, y si la app está caída no
> queremos quedarnos sin backups. Es tarea del host.

## Restaurar en un cluster vacío

`backup.sh` guarda también `roles_<fecha>.sql`. En una máquina nueva:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.yml exec -T postgres \
  psql -U $POSTGRES_USER -d postgres < backups/roles_<fecha>.sql
createdb ... && pg_restore --no-owner -d agenda_gober < backups/agenda_gober_<fecha>.dump
```

## Pendiente (antes de producción)

- **Copia fuera de la máquina.** Un backup en el mismo disco que la base no
  es un backup real. Sincronizar `./backups/` a otro disco / NAS / bucket
  (S3, Cloudflare R2) con `rclone` o `aws s3 sync` desde la misma tarea
  programada.
- **PITR** (archivado de WAL) si el RPO de minutos importa. Hoy el RPO es
  "desde el último dump" (24 h con la tarea diaria).
- **Cifrado en reposo** del bucket + rotación de credenciales.
- **Alerta** si un backup no corre o el restore de prueba falla.
