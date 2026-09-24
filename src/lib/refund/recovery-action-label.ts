/**
 * A tulajdonosi panel helyreállító gombjának felirata. A szerver üzenetei
 * (refund-recovery.ts, refund-order.ts) erre a gombra a nevével hivatkoznak,
 * a panel (src/components/admin/RefundPanel.tsx) ezt írja a gombra: egy
 * cselekvés, egy szó mindenhol (WCAG 2.2 SC 3.2.4 Consistent Identification;
 * docs/ui-sztenderdek.md 8.5: „ha a javítás egy gombbal történik, a felület
 * tényleges gombnevével”). Tiszta modul, a kliens is importálhatja.
 */
export const REFUND_RECOVERY_ACTION_LABEL = 'Feldolgozás folytatása'
