# Role permissions and server/RLS enforcement — v8

Three UI dashboards; four existing role keys retained. Roles never derive from user-editable
metadata. Enforce capability + ownership/firm/assignment + workflow state in server and RLS.

| Capability | user | reviewer | partner_admin | platform_admin |
|---|---|---|---|---|
| Own draft/doc/report, checkout | Own only | Only with separate owner identity | Same | Same |
| Professional document read | No other users | Assigned only | Own firm coordination minimum | No blanket content; audited support grant only |
| Draft/finalize legal notes/report | No | Assigned + valid professional authority | No unless separately qualified and assigned | No unless separately qualified and assigned |
| Complete extra review/Enhanced decision | No | Assigned + verified allowed scope + explicit approve | Coordinator role alone never | Admin role alone never |
| Assign/reassign | No | No by default | Own firm only | Operational routing under policy |
| Verify payment/reconcile | No | No | No | Billing capability; audit |
| Set authoritative role/price config | No | No | No | Separate restricted capability; audit |
| View platform aggregate revenue/operations | No | No | No; own firm operational queue only | Analytics capability |
| Request revocation | Own report complaint | Assigned/issuing professional | Own firm | Yes |
| Execute revocation | No | Only separately granted capability | Only separately granted capability | Explicit revoke capability; audit |
| Issue legal badge as arbitrary client write | Never | Never | Never | Never |

Public verification uses safe projection only, not direct table SELECT. All private tables
and Storage RLS default deny. Service-role secrets server-only; use narrow RPCs/transactions
that recheck caller and object authorization. Elevated key must not bypass application checks.
No general-purpose client-supplied status/price/plan/reviewer updates. Role expiry/revocation
checked again at completion; a loaded UI is not continuing authorization.
Audit operational support grants with actor/reason/scope/expiry; log safe object IDs, no
document contents. Existing optional super_admin is not required; avoid unnecessary powers.
