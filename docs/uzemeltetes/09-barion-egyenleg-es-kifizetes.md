# 09 Barion-egyenleg és kifizetés

**Mikor:** havonta a kifizetés előtt, és minden visszatérítés előtt.

## Miért kell tartalék a tárcában

- A Barion a díját a fizetéskor levonja: egy 79 500 Ft-os eladás után a
  tárcában ennél kevesebb marad.
- Visszatérítést a Barion csak a tárca egyenlegéből teljesít. Ha nincs
  fedezet, a visszatérítés `TooLowBalanceToMakeRefund` hibával elbukik, a
  dupla fizetés automatikus visszatérítése is ([06](06-visszaterites.md)).
- Visszaterhelésnél a Barion a vitatott összeg erejéig zárolhatja az egyenleget
  (ÁSZF 13.3, [07](07-visszaterheles.md)).

## A tartalék (alsó határ)

A tárcában mindig maradjon legalább:

- a legdrágább kurzus ára (2026-09-24-én 79 500 Ft), **plusz**
- a folyamatban lévő visszatérítések összege, **plusz**
- a zárolt összeg, ha van.

Az éles indulás előtt legalább 80 000 Ft-ot tölts fel magyar bankszámláról
átutalással.

## Havi kifizetés

1. A havi egyeztetés ([08](08-havi-egyeztetes.md)) után, havonta egyszer.
2. Nézd meg az egyenleget a Barion-fiókban. Kivehető: az egyenleg mínusz a
   fenti tartalék.
3. Utald a kivehető részt a cég bankszámlájára. A Barion díja magyar
   bankszámlára utalásnál 0,10%, legalább 70 Ft (Barion díjjegyzék, hatályos
   2026.01.17.).
4. A kifizetés ugyanazzal az összeggel jelenjen meg a bankszámlán; ha nem,
   eltéréslista.

## Kivonat

A Barion havonta egyszer tartós adathordozón számlakivonatot ad, és bármely
időszak kivonata bármikor letölthető (Barion ÁSZF 15.3.1). A havi kivonat PDF
a könyvelési bizonylat: töltsd le és add át a könyvelőnek.

## Amire figyelj

- A Barion bizonyos forgalmi határok elérésekor ügyfél-átvilágítást (KYC) kér;
  ez a kifizetést késleltetheti. Ha a Barion ilyet kér, intézd el gyorsan.
- A „felelős őrzés” havidíj (0,50%) csak őrzésbe vett pénzre vonatkozik, a
  szokásos működésre nem.
- A Barion-bolt értesítő címét valaki naponta olvassa: a Barion ide ír, ha az
  értesítéseit ötször sem tudta kézbesíteni, és ide jön a visszaterhelés is.
- Iratkozz fel a Barion szolgáltatási állapotára (status.barion.com, „Subscribe
  to updates”).
