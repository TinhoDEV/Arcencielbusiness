# Corriger l'erreur Supabase « délai d'attente dépassé »

Cette erreur vient du **poids de la base**, pas du code : les tables contiennent
encore d'anciennes photos stockées **en entier** (base64) dans la colonne `doc`.
Chaque ligne pèse alors plusieurs centaines de Ko, et même les requêtes internes
du tableau de bord Supabase dépassent le délai.

## Étape 1 — Mesurer (SQL Editor de Supabase)

```sql
select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as taille
from pg_catalog.pg_statio_user_tables
order by pg_total_relation_size(relid) desc;
```

Si `clients`, `clients_jour` ou `cartes_retirees` dépassent ~100 Mo, c'est la cause.

## Étape 2 — Compter les photos encore en base64

```sql
select 'clients' as t, count(*) from clients where doc->>'cardImage' like 'data:%'
union all
select 'clients_jour', count(*) from clients_jour where doc->>'cardImage' like 'data:%'
union all
select 'cartes_retirees', count(*) from cartes_retirees where doc->>'cardImage' like 'data:%';
```

## Étape 3 — Migrer les photos vers le Storage

Ouvrez la page **migration-photos.html** de l'application (espace admin) et
lancez la migration : elle transfère les images base64 vers le bucket `cartes`
et ne laisse qu'une URL courte dans la base.

## Étape 4 — Récupérer l'espace disque (SQL Editor)

Après la migration, exécutez :

```sql
vacuum full clients;
vacuum full clients_jour;
vacuum full cartes_retirees;
analyze;
```

`vacuum full` reconstruit les tables et **libère réellement** l'espace occupé par
les anciennes lignes. C'est ce qui fait repasser le tableau de bord sous le délai
d'attente.

## Étape 5 — Index utiles (optionnel, accélère les lectures)

```sql
create index if not exists idx_clients_jour_id on clients_jour (id);
create index if not exists idx_clients_id on clients (id);
create index if not exists idx_cartes_retirees_id on cartes_retirees (id);
```

## Solution d'urgence si le SQL Editor lui-même expire

Purgez d'abord les photos les plus lourdes, par petits lots :

```sql
update clients_jour
set doc = doc - 'cardImage'
where id in (
  select id from clients_jour
  where doc->>'cardImage' like 'data:%'
  limit 200
);
```

Répétez jusqu'à ce que le compte de l'étape 2 tombe à 0, puis faites le `vacuum full`.

---

**Déjà corrigé côté application (version 20260803d) :** le journal ne télécharge
plus les photos à chaque synchronisation, et la synchronisation est passée de
5 s à 20 s — la charge sur la base est très fortement réduite.
