-- ============================================================
-- Aumenta o limite de tamanho das imagens de edição do perfil. Esses
-- valores precisam bater com AVATAR_MAX_BYTES/BANNER_MAX_BYTES/
-- DECORATION_MAX_BYTES em src/lib/profileAssetLimits.ts — o app já
-- confere o tamanho no navegador ANTES de tentar enviar (pra não
-- gastar tempo de upload à toa), mas quem trava de verdade um arquivo
-- grande demais é o limite do próprio bucket aqui no banco. Se só um
-- dos dois lados for aumentado, o upload passa na checagem do app e
-- falha depois, então os dois valores sempre precisam mudar juntos.
--
--   avatars              5MB -> 10MB
--   profile-banners      8MB -> 15MB
--   avatar-decorations   2MB -> 5MB
-- ============================================================
update storage.buckets set file_size_limit = 10485760 where id = 'avatars';
update storage.buckets set file_size_limit = 15728640 where id = 'profile-banners';
update storage.buckets set file_size_limit = 5242880 where id = 'avatar-decorations';
