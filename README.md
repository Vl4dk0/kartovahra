# Chujomat 🃏

Jednoduchý zapisovač bodov pre kartovú hru — celé v slovenčine, beží úplne v prehliadači.
Stačí otvoriť `index.html`, žiadna inštalácia.

## Pravidlá

- Najprv pridáš hráčov, potom sa generuje tabuľka na body.
- Každé kolo je zvýraznené, **kto mieša a rozdáva** karty (rotuje sa dokola).
- Po každom kole zapíšeš body pre každého hráča.
- Všetci začínajú na **0**.
- Kto má **presne 100**, padá späť na **90**.
- Kto presiahne **100**, ten **je chuj!** — a hra tam končí.

## Funkcie

- 📱 Ovládateľné z mobilu (veľké tlačidlá, spodný panel na zápis kôl).
- 🎨 Body sa farbia podľa blízkosti k stovke (zlatá → červená = horí).
- ↩ Vrátenie posledného kola (aj po skončení hry, keď sa niekto pomýli).
- 💾 Automatické ukladanie do prehliadača — rozohraná hra prežije zatvorenie/refresh.
- 🔌 Funguje aj offline (fonty majú systémový fallback).

## Súbory

- `index.html` — štruktúra
- `style.css` — vzhľad
- `script.js` — logika hry
