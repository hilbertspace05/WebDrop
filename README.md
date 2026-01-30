# WebDrop

P2P file transfer in browser similar to Apple's AirDrop.

Simply go to the website [WebDrop.Space](https://WebDrop.Space) on the devices, choose files and share !

No installations whatsoever, just a website !

Made with [P2PT](https://github.com/subins2000/p2pt), WebRTC 🔥. No servers involved, 99% your browser, 1% WebTorrent Trackers.

## Features

* Easy to use
* Auto discover devices in the same network (LAN)
* Resume connection interrupted downloads
* No file download limit
* Download straight to your downloads folder without waiting
* Share through internet with a room code !
* Easily share Text Messages too !

## Why

[THIS!](https://twitter.com/SubinSiby/status/1264340589367029760)

Case 1: I want to share files with my friend's phone or computer, but we don't have a USB cable. I have a file sharing app A, my friend have B. Both of us argue "A is better", "No, B is better". The app installation size is 50MB, is half bloatware and the arguing cost us 15 minutes. If it's an iPhone & an Android, ohnooooo. Bonus: iPhone + Android + Windows PC together 🙂

Case 2: I want to copy a text from my phone to computer, arghh😫 I have to open WhatsApp Web/Telegram now, send a message to myself -_- 😒

Both the above problems are solved with [WebDrop](https://WebDrop.Space). Simply open the website on any number of your devices (even simultaneously) and share files & messages !

### Development

Clone the repo and do :

```
yarn install
yarn serve
```

WebTorrent trackers list is in `src/main.ts`. You can run your own tracker locally (see below).

File is shared via streams using [simple-peer-files library](https://github.com/subins2000/simple-peer-files).

#### "Nenhum tracker respondeu" / Trackers não conectam

Se a app avisar que não conseguiu ligar a nenhum tracker (rede bloqueada, trackers em baixo, etc.):

1. **Na mesma WiFi (LAN)** – use um **tracker local** na sua rede:
   - Instale: `yarn global add bittorrent-tracker` (ou `npm i -g bittorrent-tracker`)
   - Numa máquina na rede (ex.: o teu PC), execute: `bittorrent-tracker`
   - Em desenvolvimento (`localhost`), o WebDrop tenta primeiro `ws://127.0.0.1:8000`. Numa máquina execute: `bittorrent-tracker` (porta 8000 por defeito).
   - Para outros dispositivos na LAN, edite `src/main.ts` e use `ws://IP_DO_PC:8000` (substitua pelo IP da máquina onde corre o tracker).

2. **Sem tracker local** – tente outra rede ou VPN; ou introduza manualmente o mesmo código de 4 letras em todos os dispositivos (banner no topo quando a rede não é detectada).

## Thanks

* [Radhika Sharma](https://twitter.com/radhikaa2001) for the [logo](https://WebDrop.Space/favicon.png)
* [Buefy](https://buefy.org/)
* [Material Design Icons](https://materialdesignicons.com/)
* [WebTorrent](https://webtorrent.io)
