# Backup e Restauração do PostgreSQL — AgendaBot

Backup automático diário do banco `agendabot` em produção (VPS). Sem ele,
todos os dados de todos os tenants viveriam apenas no volume Docker
`postgres_data` — um único ponto de falha.

## Como funciona

- O serviço **`db-backup`** (definido em `docker-compose.vps.yml` e
  `docker-compose.vps.hardened.yml`) usa a imagem `postgres:16-alpine` — a
  mesma do banco, garantindo `pg_dump`/`pg_restore` na versão correta.
- Ele roda o script [`infra/backup.sh`](./backup.sh) em loop: **uma execução
  imediatamente após o `up`** (você já valida o backup no deploy) **e depois a
  cada 24 h** (`BACKUP_INTERVAL=86400` segundos).
- Cada execução faz:
  1. `pg_dump -Fc --no-owner` (formato *custom*, restaurável seletivamente);
  2. compacta com gzip e grava com *rename* atômico em
     `/backups/agendabot_<AAAAMMDD_HHMMSS>.dump.gz` (timestamp em UTC);
  3. **rotação**: mantém os **14** dumps mais recentes (`BACKUP_KEEP`), apaga
     os anteriores;
  4. upload offsite **opcional** (S3 ou rclone) — se não configurado ou se o
     upload falhar, apenas loga e mantém a cópia local; **nunca** falha o
     backup por causa do offsite.
- Se uma execução falhar (ex.: Postgres reiniciando), o loop **não morre**:
  loga o erro e tenta de novo no próximo ciclo. `restart: unless-stopped`
  cobre o caso do próprio container cair.

## Onde ficam os dumps

No volume nomeado **`pg_backups`**, montado em `/backups` dentro do container.

```bash
# Listar os backups existentes
docker compose -f docker-compose.vps.yml exec db-backup ls -lh /backups

# Ver os logs das execuções
docker compose -f docker-compose.vps.yml logs db-backup

# Forçar um backup manual agora
docker compose -f docker-compose.vps.yml exec db-backup sh /usr/local/bin/db-backup.sh

# Copiar um dump para fora do host (rode NA SUA MÁQUINA, não no VPS)
scp usuario@SEU_VPS:/var/lib/docker/volumes/<projeto>_pg_backups/_data/agendabot_*.dump.gz .
# ou, sem depender do caminho do volume:
docker compose -f docker-compose.vps.yml cp db-backup:/backups/agendabot_20260713_030000.dump.gz .
```

> Importante: o volume `pg_backups` fica no MESMO disco do VPS. Para proteção
> real contra perda do servidor, configure o offsite (abaixo).

## Restauração (disaster recovery)

> Pratique isto ANTES de precisar. Um backup que nunca foi restaurado é
> apenas uma esperança.

### 1. Restaurar em um banco novo/vazio (cenário típico: VPS novo)

```bash
# 1) Suba somente o Postgres (e o db-backup, que tem o volume de dumps)
docker compose -f docker-compose.vps.yml up -d postgres db-backup

# 2) Escolha o dump e restaure (dentro do container db-backup, que enxerga
#    /backups e tem pg_restore 16):
docker compose -f docker-compose.vps.yml exec db-backup sh -c '
  gunzip -c /backups/agendabot_20260713_030000.dump.gz > /tmp/restore.dump &&
  dropdb  -h postgres -U agendabot --if-exists agendabot_restore ;
  createdb -h postgres -U agendabot agendabot_restore &&
  pg_restore -h postgres -U agendabot -d agendabot_restore \
    --no-owner --no-privileges /tmp/restore.dump &&
  rm -f /tmp/restore.dump
'
# (PGPASSWORD já está no ambiente do container db-backup)

# 3) Confira os dados no agendabot_restore e, na janela de manutenção,
#    troque os bancos (com o backend PARADO):
docker compose -f docker-compose.vps.yml stop backend
docker compose -f docker-compose.vps.yml exec db-backup sh -c '
  psql -h postgres -U agendabot -d postgres -c "ALTER DATABASE agendabot RENAME TO agendabot_old;" &&
  psql -h postgres -U agendabot -d postgres -c "ALTER DATABASE agendabot_restore RENAME TO agendabot;"
'
docker compose -f docker-compose.vps.yml start backend
```

### 2. Restaurar direto por cima (mais rápido, DESTRUTIVO)

Só use se o banco atual já está perdido/corrompido:

```bash
docker compose -f docker-compose.vps.yml stop backend
docker compose -f docker-compose.vps.yml exec db-backup sh -c '
  gunzip -c /backups/agendabot_20260713_030000.dump.gz |
  pg_restore -h postgres -U agendabot -d agendabot \
    --clean --if-exists --no-owner --no-privileges
'
docker compose -f docker-compose.vps.yml start backend
```

O comando essencial, em resumo:

```bash
pg_restore -h postgres -U agendabot -d <banco_destino> --no-owner --no-privileges <arquivo.dump>
```

`-Fc` (formato custom) também permite restauração seletiva
(`pg_restore -t appointments ...`) e listagem do conteúdo (`pg_restore -l`).

## Offsite (S3 ou rclone) — recomendado

O script tenta o upload **somente** se as variáveis estiverem definidas no
ambiente do host na hora do `docker compose up` (nada de segredo no repo).

### Opção A — S3 / R2 via aws cli

```bash
# no VPS (ex.: /etc/profile.d/agendabot-backup.sh ou no .env do compose)
export BACKUP_S3_BUCKET=agendabot-backups
export BACKUP_S3_PREFIX=agendabot-db          # opcional (padrão: agendabot-db)
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
docker compose -f docker-compose.vps.yml up -d db-backup
```

Atenção: a imagem `postgres:16-alpine` **não traz o `aws` cli**. O script
detecta a ausência, avisa no log e mantém só o backup local. Para ativar de
verdade, escolha uma:

- instale no container (efêmero — refaça após recriar):
  `docker compose -f docker-compose.vps.yml exec db-backup apk add --no-cache aws-cli`
- **ou** use a opção B (rclone, binário único, mesmo aviso se ausente);
- **ou** sincronize a partir do host com um cron simples:
  `aws s3 sync /var/lib/docker/volumes/<projeto>_pg_backups/_data s3://agendabot-backups/agendabot-db/`

### Opção B — rclone (S3, R2, B2, Google Drive, etc.)

```bash
export BACKUP_RCLONE_REMOTE="r2:agendabot-backups/agendabot-db"
# a config do rclone (rclone.conf) precisa estar acessível no container
```

Use uma conta/chave com permissão **somente de escrita** no bucket
(write-only): se o VPS for comprometido, o invasor não apaga os backups.

## Variáveis de ambiente do serviço `db-backup`

| Variável | Padrão | Descrição |
|---|---|---|
| `PGHOST` / `PGPORT` | `postgres` / `5432` | Endereço do Postgres na rede do compose |
| `PGUSER` / `PGDATABASE` | `agendabot` / `agendabot` | Igual ao service `postgres` |
| `PGPASSWORD` | `${POSTGRES_PASSWORD}` | Mesma senha do banco (nunca comitar) |
| `BACKUP_DIR` | `/backups` | Volume `pg_backups` |
| `BACKUP_KEEP` | `14` | Quantidade de dumps diários mantidos |
| `BACKUP_INTERVAL` | `86400` | Segundos entre backups (1 dia) |
| `BACKUP_S3_BUCKET` / `BACKUP_S3_PREFIX` | vazio / `agendabot-db` | Offsite via aws cli |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` | vazio | Credenciais S3 |
| `BACKUP_RCLONE_REMOTE` | vazio | Offsite via rclone (ex.: `r2:bucket/pasta`) |

## Checklist operacional

- [ ] Após o primeiro deploy: `docker compose logs db-backup` mostra `backup OK`.
- [ ] `exec db-backup ls -lh /backups` mostra o dump do dia.
- [ ] Offsite configurado (S3 ou rclone) — o volume local não sobrevive à perda do VPS.
- [ ] **Teste de restauração feito nos últimos 90 dias** (use o cenário 1 num
      banco `agendabot_restore` — não interfere na produção).
- [ ] Monitorar: se os logs do `db-backup` mostrarem `ERRO: pg_dump falhou`
      em dias consecutivos, tratar como incidente.

## Observações

- No arquivo *hardened*, se o volume `postgres_data` foi inicializado com uma
  senha antiga, `POSTGRES_PASSWORD` exportada no host precisa ser a senha
  REAL do banco (a mesma do `DATABASE_URL`), senão o `pg_dump` falha com erro
  de autenticação.
- `pg_dump` gera um snapshot consistente (transação com MVCC); não é preciso
  parar o backend para fazer backup — só para restaurar.
- Este backup cobre o **PostgreSQL**. Uploads (`uploads`) e Redis (cache
  reconstruível) não são cobertos; avalie incluir `uploads` no offsite.
