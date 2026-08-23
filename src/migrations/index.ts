import * as migration_20260729_231123_initial_schema from './20260729_231123_initial_schema';
import * as migration_20260730_010003_products_status_enum from './20260730_010003_products_status_enum';
import * as migration_20260730_080404_sync_schema_code from './20260730_080404_sync_schema_code';
import * as migration_20260808_123444_tartalomkezeles_admin_velemenyek from './20260808_123444_tartalomkezeles_admin_velemenyek';
import * as migration_20260808_150710_szekcio_rendszer_blokkok from './20260808_150710_szekcio_rendszer_blokkok';
import * as migration_20260809_123608_kurzus_seo_mezok from './20260809_123608_kurzus_seo_mezok';
import * as migration_20260809_140731_kurzus_haladas_es_celkozonseg from './20260809_140731_kurzus_haladas_es_celkozonseg';
import * as migration_20260809_180031_storno_statusz_es_kurzus_slug from './20260809_180031_storno_statusz_es_kurzus_slug';
import * as migration_20260809_223906_szamlazz_megfeleles from './20260809_223906_szamlazz_megfeleles';
import * as migration_20260809_232121_szamlazz_attempts_seq from './20260809_232121_szamlazz_attempts_seq';
import * as migration_20260810_094820_szamlazz_refunds_oszlop from './20260810_094820_szamlazz_refunds_oszlop';
import * as migration_20260810_095237_sema_drift_allapotgep_es_jobok from './20260810_095237_sema_drift_allapotgep_es_jobok';
import * as migration_20260810_132919_job_utemezes_stats from './20260810_132919_job_utemezes_stats';
import * as migration_20260815_084028_kurzus_tananyag_modulok from './20260815_084028_kurzus_tananyag_modulok';
import * as migration_20260815_125333_kurzus_lathatosag_alapertek from './20260815_125333_kurzus_lathatosag_alapertek';
import * as migration_20260815_192419_vendeg_vasarlas_jelszo_beallitas from './20260815_192419_vendeg_vasarlas_jelszo_beallitas';
import * as migration_20260815_221033_szakerto_kartyak_blokk from './20260815_221033_szakerto_kartyak_blokk';
import * as migration_20260815_230708_kurzuskartya_kiemelesek from './20260815_230708_kurzuskartya_kiemelesek';
import * as migration_20260815_233751_kurzus_ertekesito_mezok from './20260815_233751_kurzus_ertekesito_mezok';
import * as migration_20260816_075958_nyithato_szekcio_blokk from './20260816_075958_nyithato_szekcio_blokk';
import * as migration_20260816_181452_szakerto_bejelentkezes_mezok from './20260816_181452_szakerto_bejelentkezes_mezok';
import * as migration_20260816_192821_idopontkero_szekcio_blokk from './20260816_192821_idopontkero_szekcio_blokk';
import * as migration_20260817_122044_idopontkero_urlap_kapcsolo from './20260817_122044_idopontkero_urlap_kapcsolo';
import * as migration_20260821_204356_tudastar_gyik_lektor_mezok from './20260821_204356_tudastar_gyik_lektor_mezok';
import * as migration_20260823_195638_access_grants from './20260823_195638_access_grants';

export const migrations = [
  {
    up: migration_20260729_231123_initial_schema.up,
    down: migration_20260729_231123_initial_schema.down,
    name: '20260729_231123_initial_schema',
  },
  {
    up: migration_20260730_010003_products_status_enum.up,
    down: migration_20260730_010003_products_status_enum.down,
    name: '20260730_010003_products_status_enum',
  },
  {
    up: migration_20260730_080404_sync_schema_code.up,
    down: migration_20260730_080404_sync_schema_code.down,
    name: '20260730_080404_sync_schema_code',
  },
  {
    up: migration_20260808_123444_tartalomkezeles_admin_velemenyek.up,
    down: migration_20260808_123444_tartalomkezeles_admin_velemenyek.down,
    name: '20260808_123444_tartalomkezeles_admin_velemenyek',
  },
  {
    up: migration_20260808_150710_szekcio_rendszer_blokkok.up,
    down: migration_20260808_150710_szekcio_rendszer_blokkok.down,
    name: '20260808_150710_szekcio_rendszer_blokkok',
  },
  {
    up: migration_20260809_123608_kurzus_seo_mezok.up,
    down: migration_20260809_123608_kurzus_seo_mezok.down,
    name: '20260809_123608_kurzus_seo_mezok',
  },
  {
    up: migration_20260809_140731_kurzus_haladas_es_celkozonseg.up,
    down: migration_20260809_140731_kurzus_haladas_es_celkozonseg.down,
    name: '20260809_140731_kurzus_haladas_es_celkozonseg',
  },
  {
    up: migration_20260809_180031_storno_statusz_es_kurzus_slug.up,
    down: migration_20260809_180031_storno_statusz_es_kurzus_slug.down,
    name: '20260809_180031_storno_statusz_es_kurzus_slug',
  },
  {
    up: migration_20260809_223906_szamlazz_megfeleles.up,
    down: migration_20260809_223906_szamlazz_megfeleles.down,
    name: '20260809_223906_szamlazz_megfeleles',
  },
  {
    up: migration_20260809_232121_szamlazz_attempts_seq.up,
    down: migration_20260809_232121_szamlazz_attempts_seq.down,
    name: '20260809_232121_szamlazz_attempts_seq',
  },
  {
    up: migration_20260810_094820_szamlazz_refunds_oszlop.up,
    down: migration_20260810_094820_szamlazz_refunds_oszlop.down,
    name: '20260810_094820_szamlazz_refunds_oszlop',
  },
  {
    up: migration_20260810_095237_sema_drift_allapotgep_es_jobok.up,
    down: migration_20260810_095237_sema_drift_allapotgep_es_jobok.down,
    name: '20260810_095237_sema_drift_allapotgep_es_jobok',
  },
  {
    up: migration_20260810_132919_job_utemezes_stats.up,
    down: migration_20260810_132919_job_utemezes_stats.down,
    name: '20260810_132919_job_utemezes_stats',
  },
  {
    up: migration_20260815_084028_kurzus_tananyag_modulok.up,
    down: migration_20260815_084028_kurzus_tananyag_modulok.down,
    name: '20260815_084028_kurzus_tananyag_modulok',
  },
  {
    up: migration_20260815_125333_kurzus_lathatosag_alapertek.up,
    down: migration_20260815_125333_kurzus_lathatosag_alapertek.down,
    name: '20260815_125333_kurzus_lathatosag_alapertek',
  },
  {
    up: migration_20260815_192419_vendeg_vasarlas_jelszo_beallitas.up,
    down: migration_20260815_192419_vendeg_vasarlas_jelszo_beallitas.down,
    name: '20260815_192419_vendeg_vasarlas_jelszo_beallitas',
  },
  {
    up: migration_20260815_221033_szakerto_kartyak_blokk.up,
    down: migration_20260815_221033_szakerto_kartyak_blokk.down,
    name: '20260815_221033_szakerto_kartyak_blokk',
  },
  {
    up: migration_20260815_230708_kurzuskartya_kiemelesek.up,
    down: migration_20260815_230708_kurzuskartya_kiemelesek.down,
    name: '20260815_230708_kurzuskartya_kiemelesek',
  },
  {
    up: migration_20260815_233751_kurzus_ertekesito_mezok.up,
    down: migration_20260815_233751_kurzus_ertekesito_mezok.down,
    name: '20260815_233751_kurzus_ertekesito_mezok',
  },
  {
    up: migration_20260816_075958_nyithato_szekcio_blokk.up,
    down: migration_20260816_075958_nyithato_szekcio_blokk.down,
    name: '20260816_075958_nyithato_szekcio_blokk',
  },
  {
    up: migration_20260816_181452_szakerto_bejelentkezes_mezok.up,
    down: migration_20260816_181452_szakerto_bejelentkezes_mezok.down,
    name: '20260816_181452_szakerto_bejelentkezes_mezok',
  },
  {
    up: migration_20260816_192821_idopontkero_szekcio_blokk.up,
    down: migration_20260816_192821_idopontkero_szekcio_blokk.down,
    name: '20260816_192821_idopontkero_szekcio_blokk',
  },
  {
    up: migration_20260817_122044_idopontkero_urlap_kapcsolo.up,
    down: migration_20260817_122044_idopontkero_urlap_kapcsolo.down,
    name: '20260817_122044_idopontkero_urlap_kapcsolo',
  },
  {
    up: migration_20260821_204356_tudastar_gyik_lektor_mezok.up,
    down: migration_20260821_204356_tudastar_gyik_lektor_mezok.down,
    name: '20260821_204356_tudastar_gyik_lektor_mezok',
  },
  {
    up: migration_20260823_195638_access_grants.up,
    down: migration_20260823_195638_access_grants.down,
    name: '20260823_195638_access_grants'
  },
];
