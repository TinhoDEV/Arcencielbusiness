# Sécurité — Arc en Ciel Business

Ce document résume l'analyse de sécurité du site et les renforcements appliqués,
puis l'**action critique** qui vous reste à faire côté Supabase.

---

## 1. Renforcements DÉJÀ appliqués (dans le code)

| # | Faille corrigée | Avant | Maintenant |
|---|-----------------|-------|------------|
| 1 | **Contournement de connexion** | Il suffisait de taper `sessionStorage.setItem("acb_admin_session","true")` dans la console pour entrer. | Jeton de session **signé** (`auth.js`). Un jeton trafiqué est rejeté → redirection vers la connexion. |
| 2 | **Sessions sans expiration** | La session restait valide indéfiniment. | **Durée de vie max 12 h** + déconnexion pour inactivité (2 min staff / 5 min admin). |
| 3 | **Mot de passe admin en clair** | Stocké en clair dans le navigateur et dans Supabase. | **Haché en SHA-256** (jamais stocké en clair). Migration automatique à la 1ʳᵉ connexion. |
| 4 | **Anti-force-brute contournable** | Le blocage après 3 essais se réinitialisait en rechargeant la page. | Blocage **persistant** (survit au rechargement), admin **et** staff. |
| 5 | **Mot de passe admin trop court** | Minimum 4 caractères. | Minimum **6 caractères**. |
| 6 | **Gardes d'accès incohérentes** | Vérifications dispersées et faciles à tromper. | Centralisées dans `auth.js` (`Auth.requireRole`). |

> Note : les mots de passe **staff** restent lisibles dans la base (c'est voulu :
> l'admin doit pouvoir les communiquer). C'est un outil interne — accepté.

---

## 2. ✅ Blocage de la suppression anonyme (maintenant SANS RISQUE)

Depuis la « suppression douce », l'application **n'envoie plus jamais de DELETE**
à Supabase (les éléments retirés sont marqués `deleted:true` et masqués).
On peut donc bloquer la suppression anonyme **sans rien casser**.

Dans Supabase → **SQL Editor** → collez et exécutez ce bloc **une fois** :

```sql
-- Active RLS et autorise lecture + insertion + mise à jour, mais REFUSE
-- la suppression via la clé publique (anti-effacement massif).
do $$
declare t text;
begin
  foreach t in array array['clients','staff','cartes_retirees','config','counters']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "anon_select" on public.%I;', t);
    execute format('drop policy if exists "anon_insert" on public.%I;', t);
    execute format('drop policy if exists "anon_update" on public.%I;', t);
    execute format('create policy "anon_select" on public.%I for select using (true);', t);
    execute format('create policy "anon_insert" on public.%I for insert with check (true);', t);
    execute format('create policy "anon_update" on public.%I for update using (true) with check (true);', t);
    -- AUCUNE policy DELETE => suppression refusée pour la clé publique.
  end loop;
end $$;
```

**Résultat :** personne ne peut plus vider/supprimer vos tables avec la clé
publique. L'app continue de fonctionner normalement (lecture, enregistrement,
mises à jour, retraits, suppressions « douces »).

**Purge réelle (optionnelle) :** pour effacer définitivement les lignes
marquées `deleted`, faites-le vous-même depuis le tableau de bord Supabase
(Table editor), ou exécutez par ex. `delete from public.clients where (doc->>'deleted')::boolean is true;`.

---

## 3. Bon réflexe
- Changez le mot de passe admin par défaut (`arcenciel2024`) dès maintenant via
  **Paramètres** — il sera stocké haché.
- Utilisez des mots de passe staff longs (le générateur fait 8 caractères).
