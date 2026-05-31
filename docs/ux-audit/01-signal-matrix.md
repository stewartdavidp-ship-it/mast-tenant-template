# Signal Matrix — objective grep counts across all 45 modules

These are raw occurrence counts from `app/modules/*.js` (2026-05-30). They are *signals*, not verdicts — but they anchor the objective rubric criteria. Read alongside the qualitative scorecards in `03-scorecards.md`.

## Pass 1 — shared-helper / standard-class adoption

`openMdl`=`openModal(` · `mastCnf`=`mastConfirm/Alert/Prompt` · `winCnf`=`window.confirm/alert/prompt` (🚩) · `toast`=`showToast` · `sortRow`=sort-key/`mastSortRows` · `dataTbl`=`.data-table` · `btn`=`.btn-*` variant classes · `empty`=`.empty-state*` · `loading`=`.loading` class · `formGrp`=`.form-group/-label/-input` · `badge`=`.status-badge` · `filtPill`=filter-pills · `navStk`=`MastNavStack`/`.detail-back`/`backTo`

```
MODULE                 lines openMdl mastCnf winCnf toast sortRow dataTbl  btn empty loading formGrp badge filtPill navStk
accounting.js           1551      0      1      3     3      0      0     20     0     0       0     0      0     0
advisor.js              1401      0      4      4    22      0      0     23     2     0       0     0      0     0
audit-feedback.js        816      0      3      2     2      0      0      7     0     1       0     2      0     0
audit.js                1717      0      0      0     2      0      0     24     0     1       0     0      0     0
blog.js                 2333      6      1      0    66      0      0     20     0     0       0     5      0     6
book.js                 5846      0      7      3    81     25     12     66     0     0     151     0      0    13
brand.js                 582      1      1      0    16      0      0     12     0     0       0     2      0     0
campaigns.js             456      3      0      3    12      0      2     13     0     1       6     0      0     1
cart.js                 1392      7      1      0    26      0      2     31     0     5       0     5      0     0
channels.js             2797      0      1      2    28      0      6     24     0     0       0     0      0    17
commission-terms.js      317      0      1      0     5      0      1      6     0     0       1     0      0     0
composer.js              434      1      0      1     7      0      0      8     0     1       4     0      0     1
consignment.js          2146      7      2      0    42     10      0     47     0     0      18     2      2     7
contacts.js             1597      4      0      0    32      0      0     17     0     1      18     5      0    12
customer-service.js     3229      0      0      7    95      0      0    129     0     3      20    10      4     9
customers.js            3531      2     14      0    10     13      6     40     0     8      18    10      0    23
email-log.js             561      0      1      0     4     12      1      3     0     0       0     0      4     0
engagement-inbox.js      485      0      0      1     9      0      0     10     0     1       0     0      0     0
events.js               1937      0      8      0    63      0      0     61     0     1     137     1      0     2
finance.js              8052      0      7      3   121     24      1    173     0     0       0     1      0     4
financials.js            350      0      0      0     4      0      0      0     0     0       0     0      0     0
fulfillment.js          1524      2      0      0    17     10      0     21     5     0       0     2      0     0
homepage.js              681       0      0      0     8      0      0      6     2     1       0     0      0     0
lookbooks.js             822       1      1      0    10      0      1     18     0     0       9     2      0     1
maker.js                6650       0     22      2   116      0      4     87     0     2       0     8      0    10
mapping.js              1724       0      0      0     2      0      0     26     0     2       0     0      0     0
marketing-calendar.js    270       0      0      0     0      0      0     12     0     1       0     0      0     0
newsletter.js           2286       5      6      1    71      0      0     38     0     0       0     1      0     1
orders.js               6262      12      2      4   106     15      0     67     1     2      21    23      2    19
procurement.js          1917       3      3      0    26      0      0     35     0     1      21     3      0    15
production.js           3553      11      7      0    65      0      0     60     0     0      19     7      0    13
promotions.js            529       3      0      0    13      0      0      7     0     0      12     0      0     0
sales.js                3188       3      6      1    46      9      2     48     0     1      11     3      0     2
show-light.js           1718       4      3      0    34      0      0     22     0     0      39     1      0     0
shows.js                3580       1      7      0    66      0      0     26     0     0       0     6      0     9
social.js               1441       1      0      0    22      0      0     17     0     4       5     5      0     6
students.js             1478       0      4      0    33      0      0     26     0     2       0     0      0     8
studio.js                788       0      4      0    24      0      0     31     0     1       0     0      0     0
team.js                 3199       0      6      2    65      0      0     96     0    13       0     1      2     2
trips.js                2157       0      3      0    33      0      0      7     0     0       0     0      2     0
website.js              3072       1      0      0    49      0      0     58     0     1       0     1      0     1
wholesale.js            1852       0      3      0    28     10      3     11     1     0       0     1      0     0
```

## Pass 2 — visual consistency / divergence tells

`hexHard`=hardcoded `#rrggbb` literals (🚩 dark-mode + token risk) · `varTok`=`var(--…)` token uses · `inlineSty`=`style=` attributes · `translateX`=slide-out/drawer tells · `posFixed`=`position:fixed` (rogue-overlay tell) · `detailView`=`*ListView`/`*DetailView` toggles (list↔detail-page pattern)

```
MODULE                 lines hexHard varTok inlineSty translateX posFixed detailView
accounting.js           1551      54     70     167        0        1        0
advisor.js              1401      64     94      67        0        1        0
audit-feedback.js        816       0     30      31        0        0        0
audit.js                1717       7     79     124        5        0        0
blog.js                 2333      13     70     115        0        0        0
brand.js                 582       4     63      77        0        0        0
campaigns.js             456       0     14      51        0        0        0
cart.js                 1392      23    121     245        0        0        0
channels.js             2797      59    211     279        0        1        0
commission-terms.js      317       8      9      26        0        0        0
composer.js              434       0     16      42        0        0        0
consignment.js          2146      31    122     386        0        0        0
contacts.js             1597      33     46      89        0        0       10
customer-service.js     3229      18    225     404        0        3        0
customers.js            3531      26    150     208        0        0        0
email-log.js             561      25     24      60        1        0        0
engagement-inbox.js      485       4     12      35        0        1        0
events.js               1937      40     68     184        0        0        0
finance.js              8052     320    459     845        6        5        0
financials.js            350      23     21      48        0        0        0
fulfillment.js          1524      18     72     184        0        1        0
homepage.js              681       1     22      26        0        0        0
lookbooks.js             822       7     30      70        0        0        0
maker.js                6650      52    286     526        0        7        0
mapping.js              1724       1     64     125        0        2        0
marketing-calendar.js    270       5     14      27        0        0        0
newsletter.js           2286      25     73     176        0        0        0
orders.js               6262     108    279     533        0        2       28
procurement.js          1917       3    132     184        0        0        0
production.js           3553      16    114     289        0        0       28
promotions.js            529       7     14      29        0        0        0
sales.js                3188      30    151     335        0        2       10
show-light.js           1718       1    106     174        0        0        0
shows.js                3580     158    396     567        0        7        8
social.js               1441      13     27      64        0        0        0
students.js             1478      33    149     211        0        1        0
studio.js                788       2    100     127        0        0        0
team.js                 3199      53    246     412        0        1        0
trips.js                2157      36     57     139        0        3        0
website.js              3072      32    215     368        0        1        0
wholesale.js            1852      68    138     286        0        2        0
```

## Reading notes (cross-cutting findings already visible)

- **`window.confirm/alert/prompt` is still live** in: customer-service (7), advisor (4), orders (4), accounting (3), finance (3), audit-feedback (2), channels (2), maker (2), team (2), plus single uses (campaigns, composer, engagement-inbox, newsletter, sales). → C1 flag. (`mastConfirm` exists explicitly to replace these.)
- **Modal adoption is bimodal.** Heavy `openModal` users (orders 12, production 11, consignment/cart 7, blog 6, newsletter 5) vs. many modules with `0` that nonetheless do secondary actions → either no modal, or a hand-rolled one. `posFixed` spikes (maker 7, shows 7, finance 5) flag rogue overlays.
- **Sort is rare.** Only book, finance, orders, customers, sales, consignment, wholesale, fulfillment, email-log show sort signals. Most list modules have **no interactive sort** (B2 weakness platform-wide).
- **`.data-table` is the minority.** Most modules build inline-styled grids; `.data-table` appears in only ~12 modules and often few times.
- **Filter pills barely adopted** (`mastRenderFilterPills`): customer-service, email-log, orders, consignment, team, trips, wholesale only — and partial.
- **`.empty-state` almost unused** (advisor, fulfillment, homepage, orders, wholesale ~ only). Most empty states are inline text → C4 platform-wide weakness.
- **Hardcoded color hotspots:** finance (320), shows (158), orders (108), book (88), wholesale (68), advisor (64), channels (59), accounting (54), team (53), maker (52). Normalize per-KLOC for fairness (see scorecards), but finance/shows/wholesale are high even adjusted → D1 + dark-mode risk.
- **`MastNavStack`/back adoption** strong in customers (23), orders (19), channels (17), procurement (15), book/production (13), contacts (12); **absent** in many smaller modules that still navigate (accounting, advisor, audit, mapping, studio, team, website≈1, trips 0) → A1 weakness.
- **Form-field standard** concentrated in book (151), events (137), procurement/orders (21), customers/contacts/consignment (18); zero in many → C3 inconsistency.
