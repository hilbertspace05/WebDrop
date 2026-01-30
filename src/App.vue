<template>
  <div id="app">
    <Header />
    <div v-if="networkDetectionFailed" class="network-failed-banner">
      <div class="container">
        <p><strong>Rede não detectada.</strong> Para ligar dispositivos na mesma WiFi, introduza o mesmo código de 4 letras em todos:</p>
        <div class="field has-addons">
          <div class="control">
            <input
              v-model="manualRoomCode"
              class="input"
              type="text"
              maxlength="4"
              placeholder="código (4 letras)"
              @keyup.enter="joinWithManualCode"
            />
          </div>
          <div class="control">
            <button class="button is-primary" @click="joinWithManualCode">Entrar na LAN</button>
          </div>
        </div>
        <p class="help">Ou use <router-link to="/room">Sala / Convidar</router-link> para obter ou introduzir um código.</p>
      </div>
    </div>
    <transition name='slide-fade'>
      <keep-alive>
        <router-view v-bind:class="{ noanim: !$store.state.settings.anim }" />
      </keep-alive>
    </transition>
  </div>
</template>

<script>
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as hashSum from 'hash-sum'
import * as P2PT from 'p2pt'
import { getPublicIp } from './utils/publicIp'

// import 'vue-material-design-icons/styles.css'

const CHUNK_SIZE = 16 * 1024

export default {
  name: 'App',

  data () {
    return {
      networkDetectionFailed: false,
      manualRoomCode: '',
      trackerDebug: { urls: [], errors: [] },
      // Chunked file transfer over P2PT (receiver)
      pendingChunkedReceives: {},
      fileChunkBuffers: {}
    }
  },

  methods: {
    init () {
      this.setUpP2PT()

      this.$store.subscribe((mutation) => {
        if (mutation.type === 'activateInternetShare') {
          this.$store.commit('destroyP2PT')
          this.startP2PT(this.$store.state.roomID)

          this.$buefy.toast.open({
            duration: 4000,
            message: `Joined Room <b>${this.$store.state.roomID}</b>`,
            position: 'is-top',
            type: 'is-info'
          })
        }
      })

      this.$root.$on('ping', (users) => {
        const data = {
          type: 'ping'
        }
        for (const user of users) {
          this.$store.state.p2pt.send(user.conn, data)
        }
      })
    },

    async setUpP2PT () {
      this.networkDetectionFailed = false

      // Se veio de um link de convite
      const roomID = this.$route.query.room
      if (roomID && this.$validateRoomCode(roomID)) {
        this.$store.commit('activateInternetShare', roomID)
        this.startP2PT(roomID)
        return
      }

      try {
        const ip = await getPublicIp()
        const roomID = hashSum(ip).substr(0, this.$INTERNET_ROOM_CODE_LENGTH)
        this.$store.commit('setRoom', roomID)
        this.startP2PT(roomID)
      } catch (error) {
        console.warn('Public IP detection failed:', error)
        this.networkDetectionFailed = true
        this.$buefy.snackbar.open({
          message: 'Não foi possível detectar a rede. Introduza um código de 4 letras acima para conectar dispositivos na mesma WiFi.',
          position: 'is-top',
          type: 'is-warning',
          queue: false,
          indefinite: true
        })
      }
    },

    joinWithManualCode () {
      const code = (this.manualRoomCode || '').trim().toLowerCase()
      if (!this.$validateRoomCode(code)) {
        this.$store.dispatch('invalidRoomCode')
        return
      }
      this.$store.commit('destroyP2PT')
      this.$store.commit('activateInternetShare', code)
      this.startP2PT(code)
      this.networkDetectionFailed = false
      this.manualRoomCode = ''
      this.$buefy.toast.open({
        duration: 3000,
        message: `Entrou na sala <b>${code}</b>`,
        position: 'is-top',
        type: 'is-success'
      })
    },

    startP2PT (identifier) {
      // Evitar múltiplas instâncias (ex.: Android a re-montar ou re-anunciar)
      if (this.$store.state.p2pt) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] A destruir P2PT anterior antes de criar nova conexão')
        }
        this.$store.commit('destroyP2PT')
      }

      let urls = this.$ANNOUNCE_URLS.slice()
      const custom = (this.$store.state.settings.customTrackerUrl || '').trim()
      if (custom) {
        urls = [custom, ...urls]
      }
      this.trackerDebug = { urls: urls.slice(), errors: [] }
      console.log('[WebDrop] Conectando a', urls.length, 'tracker(s):', urls)
      const p2pt = new P2PT(urls)
      p2pt.setIdentifier('webdrop' + identifier)

      p2pt.on('peerconnect', (peer) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] Peer conectado:', peer.id)
        }
        p2pt.send(peer, {
          type: 'init',
          name: this.$store.state.settings.name,
          color: this.$store.state.settings.color,
          sharesCount: Object.keys(this.$store.state.shares).length,
          msgsCount: this.$store.state.msgs.length
        })
      })

      p2pt.on('msg', (peer, msg) => {
        if (typeof msg !== 'object') return

        const type = msg.type

        if (type === 'getShares') {
          this.sendSharesState(p2pt, peer)
        } else if (type === 'getMsgs') {
          this.sendMsgsState(p2pt, peer)
        } else if (type === 'init') {
          const alreadyHadUser = !!this.$store.state.users[peer.id]
          this.$store.commit('addUser', {
            id: peer.id,
            name: msg.name,
            color: msg.color,
            conn: peer
          })
          // Só pedir shares/msgs uma vez por peer (evita flood quando há vários canais)
          if (alreadyHadUser) return

          if (msg.sharesCount > Object.keys(this.$store.state.shares).length) {
            p2pt.send(peer, {
              type: 'getShares'
            })
          }

          if (msg.msgsCount > this.$store.state.msgs.length) {
            p2pt.send(peer, {
              type: 'getMsgs'
            })
          }
        } else if (type === 'ping') {
          this.$buefy.snackbar.open({
            duration: 3000,
            message: `<b>${this.$store.state.users[peer.id].name}</b> pinged!`,
            type: 'is-warning',
            queue: false
          })
        } else if (type === 'newShare') {
          delete msg.type
          msg.peer = peer
          // sendSharesState envia "i", addShare envia "shareID" – normalizar
          if (!msg.shareID && msg.i) msg.shareID = msg.i
          if (process.env.NODE_ENV !== 'production') {
            console.log('[WebDrop] Recebido newShare:', msg.name || msg.shareID, 'shareID:', msg.shareID)
          }
          this.$store.commit('newShare', msg)
        } else if (type === 'startSending') {
          const shareID = msg.shareID
          const share = this.$store.state.shares[shareID]
          if (process.env.NODE_ENV !== 'production') {
            console.log('[WebDrop] Recebido startSending shareID:', shareID, 'share existe:', !!share, 'tem file:', !!(share && share.file))
          }
          if (share && share.file && !share.paused) {
            this.sendFileChunked(p2pt, peer, shareID, share)
          }
        } else if (type === 'fileStart') {
          this.onFileStart(peer, msg)
        } else if (type === 'fileChunk') {
          this.onFileChunk(peer, msg)
        } else if (type === 'fileEnd') {
          this.onFileEnd(peer, msg)
        } else if (type === 'msg') {
          // msg exist check
          if (msg.id && this.$store.state.msgs[msg.id]) {
            return
          }

          // msgs being restored will have name & color with them
          if (!msg.name) {
            msg.name = this.$store.state.users[peer.id].name
            msg.color = this.$store.state.users[peer.id].color
          }

          delete msg.type

          this.$store.commit('addMessage', msg)

          // copy to clipboard ?
          if (this.$store.state.settings.autoCopy) {
            this.$copyText(msg.msg).then(() => {
              this.$buefy.toast.open({
                duration: 2000,
                message: 'Message Copied !',
                position: 'is-top',
                type: 'is-primary'
              })
            })
          }
        }
      })

      p2pt.on('peerclose', (peer) => {
        this.$store.commit('removeUser', peer.id)
      })

      let warningCount = 0
      let trackerConnected = false
      let warningMsg = false

      p2pt.on('trackerwarning', (error, stats) => {
        warningCount++
        const total = (stats && stats.total) || 0
        const errMsg = error && (error.message || error.toString()) ? (error.message || error.toString()) : String(error)
        this.trackerDebug.errors.push({ message: errMsg, stats: stats ? { total: stats.total } : {} })
        console.warn('[WebDrop] Tracker falhou', warningCount + '/' + (total || '?'), errMsg, error)

        if (total && warningCount >= total && !trackerConnected && !warningMsg) {
          console.error('[WebDrop] Todos os trackers falharam. URLs:', this.trackerDebug.urls, 'Erros:', this.trackerDebug.errors)
          const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          const localHint = isLocalhost
            ? ' Para LAN: execute um tracker local (README).'
            : ' Pode tentar VPN ou usar um tracker local na rede.'
          const showDebugAndRetry = () => {
            const lines = [
              'Trackers tentados:',
              ...this.trackerDebug.urls.map((u, i) => `  ${i + 1}. ${u}`),
              '',
              'Erros:',
              ...this.trackerDebug.errors.map((e, i) => `  ${i + 1}. ${e.message}`)
            ]
            const text = lines.join('\n')
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(() => {
                this.$buefy.toast.open({ message: 'Debug copiado para a área de transferência', type: 'is-info', duration: 3000 })
              }).catch(() => { /* clipboard copy failed */ })
            }
            this.$buefy.dialog.confirm({
              title: 'Debug trackers',
              message: `<pre style="text-align:left;font-size:12px;max-height:50vh;overflow:auto;white-space:pre-wrap;">${lines.map(l => String(l).replace(/</g, '&lt;').replace(/&/g, '&amp;')).join('\n')}</pre>`,
              confirmText: 'Tentar de novo',
              cancelText: 'Fechar',
              type: 'is-info',
              onConfirm: () => {
                if (!trackerConnected) {
                  this.$store.commit('destroyP2PT')
                  p2pt.destroy()
                  this.startP2PT(identifier)
                }
                if (warningMsg) warningMsg.close()
              }
            })
          }
          warningMsg = this.$buefy.snackbar.open({
            message: 'Nenhum tracker WebTorrent respondeu.' + localHint + ' (F12 = consola)',
            position: 'is-top',
            type: 'is-danger',
            queue: false,
            indefinite: true,
            actionText: 'Detalhes',
            onAction: showDebugAndRetry
          })
        }
      })

      p2pt.on('trackerconnect', () => {
        trackerConnected = true
        if (warningMsg) warningMsg.close()
        console.log('[WebDrop] Tracker conectado')
      })

      this.$store.commit('setP2PT', p2pt)
      p2pt.start()
    },

    sendSharesState (p2pt, peer) {
      for (const infoHash in this.$store.state.shares) {
        let share = this.$store.state.shares[infoHash]

        // only send shares created by me
        if (!share.mine) continue

        share = {
          ...share,
          ...{
            type: 'newShare',
            i: infoHash
          }
        }
        p2pt.send(peer, share)
      }
    },

    sendMsgsState (p2pt, peer) {
      for (const id in this.$store.state.msgs) {
        const msg = this.$store.state.msgs[id]
        p2pt.send(peer, {
          ...msg,
          ...{
            type: 'msg',
            id: id
          }
        })
      }
    },

    // ---- Chunked file transfer over P2PT ----
    createTransferStub (peer) {
      const stub = {
        peer: Object.assign({ _id: peer.id }, peer),
        _handlers: {},
        on (ev, fn) {
          if (!stub._handlers[ev]) stub._handlers[ev] = []
          stub._handlers[ev].push(fn)
        },
        emit (ev, ...args) {
          (stub._handlers[ev] || []).forEach(fn => fn(...args))
        }
      }
      return stub
    },

    readChunkAsBase64 (file, index) {
      const start = index * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const blob = file.slice(start, end)
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result
          const base64 = (result && typeof result === 'string' && result.includes(',')) ? result.split(',')[1] : ''
          resolve(base64)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
    },

    async sendFileChunked (p2pt, peer, shareID, share) {
      const file = share.file
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const transferStub = this.createTransferStub(peer)

      this.$store.commit('setTransfer', { shareID, transfer: transferStub })

      transferStub.on('progress', (progress, sentBytes) => {
        this.$store.dispatch('uploadProgress', {
          shareID,
          userID: peer.id,
          progress: parseInt(progress),
          bytes: sentBytes
        })
      })
      transferStub.on('done', () => {
        this.$store.commit('removeTransfer', { shareID, userID: transferStub.peer._id })
      })

      try {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] Remetente: a iniciar envio, file.size:', file.size, 'totalChunks:', totalChunks)
        }
        // P2PT send() espera resposta; usamos fire-and-forget para mensagens unidirecionais
        p2pt.send(peer, {
          type: 'fileStart',
          shareID,
          name: share.name,
          size: file.size,
          totalChunks
        }).catch(err => console.warn('[WebDrop] fileStart send falhou:', err))

        let prevBytes = 0
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] Remetente: fileStart enviado, a ler e enviar', totalChunks, 'chunks')
        }
        for (let i = 0; i < totalChunks; i++) {
          if (i === 0 && process.env.NODE_ENV !== 'production') {
            console.log('[WebDrop] Remetente: a ler chunk 0')
          }
          const base64 = await this.readChunkAsBase64(file, i)
          if (i === 0 && process.env.NODE_ENV !== 'production') {
            console.log('[WebDrop] Remetente: chunk 0 lido, tamanho base64:', base64.length)
          }
          // Fire-and-forget (não esperamos resposta)
          p2pt.send(peer, {
            type: 'fileChunk',
            shareID,
            index: i,
            data: base64,
            totalChunks
          }).catch(() => { /* ignore send errors */ })

          const sentBytes = Math.min((i + 1) * CHUNK_SIZE, file.size)
          const progress = totalChunks > 0 ? Math.floor(((i + 1) / totalChunks) * 100) : 100
          transferStub.emit('progress', progress, sentBytes - prevBytes)
          prevBytes = sentBytes
          if (i === 0 && process.env.NODE_ENV !== 'production') {
            console.log('[WebDrop] Remetente: chunk 0 enviado via P2PT')
          }
          if (i > 0 && i % 100 === 0 && process.env.NODE_ENV !== 'production') {
            console.log('[WebDrop] Remetente: enviados', i, 'chunks de', totalChunks)
          }
          // Pequeno atraso para não sobrecarregar o canal WebRTC
          if (i % 50 === 0) await new Promise(resolve => setTimeout(resolve, 10))
        }
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] Remetente: todos os chunks enviados, a enviar fileEnd')
        }
        p2pt.send(peer, { type: 'fileEnd', shareID }).catch(() => { /* ignore */ })
        transferStub.emit('progress', 100, file.size - prevBytes)
        transferStub.emit('done')
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] Remetente: transferência completa')
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[WebDrop] sendFileChunked falhou:', err)
        }
        this.$buefy.toast.open({
          message: 'Erro ao enviar ficheiro. Tente de novo.',
          type: 'is-danger',
          duration: 6000,
          position: 'is-bottom'
        })
        this.$store.commit('removeTransfer', { shareID, userID: transferStub.peer._id })
      }
    },

    registerChunkedReceive (shareID, resolve, reject) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[WebDrop] Recetor: a registar pending para shareID:', shareID)
      }
      this.pendingChunkedReceives[shareID] = { resolve, reject }
      setTimeout(() => {
        if (this.pendingChunkedReceives[shareID]) {
          delete this.pendingChunkedReceives[shareID]
          reject(new Error('Transferência expirou'))
        }
      }, 120000)
    },

    onFileStart (peer, msg) {
      const shareID = msg.shareID
      const pending = this.pendingChunkedReceives[shareID]
      if (process.env.NODE_ENV !== 'production') {
        console.log('[WebDrop] Recetor: fileStart recebido, shareID:', shareID, 'totalChunks:', msg.totalChunks, 'pending:', !!pending)
      }
      const transferStub = this.createTransferStub(peer)
      this.fileChunkBuffers[shareID] = {
        transferStub,
        chunks: [],
        totalChunks: msg.totalChunks,
        name: msg.name,
        size: msg.size
      }
      if (pending && pending.resolve) {
        delete this.pendingChunkedReceives[shareID]
        pending.resolve(transferStub)
        if (process.env.NODE_ENV !== 'production') {
          console.log('[WebDrop] Recetor: pending resolvido, buffer criado para', msg.totalChunks, 'chunks')
        }
      }
    },

    onFileChunk (peer, msg) {
      const { shareID, index, data, totalChunks } = msg
      const buf = this.fileChunkBuffers[shareID]
      if (!buf) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[WebDrop] fileChunk recebido mas buffer não existe para shareID:', shareID)
        }
        return
      }
      buf.chunks[index] = data
      const received = buf.chunks.filter(Boolean).length
      // Mostrar pelo menos 1% quando há dados (evita ficar em 0% em ficheiros grandes)
      const rawProgress = totalChunks > 0 ? (received / totalChunks) * 100 : 0
      const progress = received > 0 ? Math.max(1, Math.floor(rawProgress)) : 0
      const approxBytes = Math.min(received * CHUNK_SIZE, buf.size)
      if (index === 0 && process.env.NODE_ENV !== 'production') {
        console.log('[WebDrop] Recetor: primeiro chunk (0) recebido, progress:', progress + '%')
      }
      buf.transferStub.emit('progress', progress, approxBytes)
    },

    onFileEnd (peer, msg) {
      const shareID = msg.shareID
      const buf = this.fileChunkBuffers[shareID]
      if (!buf) return
      const binary = []
      for (let i = 0; i < buf.totalChunks; i++) {
        const b64 = buf.chunks[i]
        if (!b64) {
          if (process.env.NODE_ENV !== 'production') console.warn('[WebDrop] Chunk em falta:', i)
          this.$buefy.toast.open({ message: 'Transferência incompleta. Tente de novo.', type: 'is-warning', duration: 5000 })
          return
        }
        const bin = atob(b64)
        const arr = new Uint8Array(bin.length)
        for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j)
        binary.push(arr)
      }
      const blob = new Blob(binary, { type: 'application/octet-stream' })
      delete this.fileChunkBuffers[shareID]
      buf.transferStub.emit('done', blob)
    }
  },

  mounted () {
    this.init()
    this.$root.$on('registerChunkedReceive', ({ shareID, resolve, reject }) => {
      this.registerChunkedReceive(shareID, resolve, reject)
    })
  }
}
</script>

<style lang="scss">
// @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400&display=swap');

#app {
  font-family: 'Ubuntu', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.noanim {
  -webkit-transition: none !important;
  -moz-transition: none !important;
  -o-transition: none !important;
  transition: none !important;
}

// Import Bulma's core
@import "~bulma/sass/utilities/_all";

// Set your colors
$primary: #8c67ef;
$primary-invert: findColorInvert($primary);
$twitter: #4099FF;
$twitter-invert: findColorInvert($twitter);

// Setup $colors to use as bulma classes (e.g. 'is-twitter')
$colors: (
    "white": ($white, $black),
    "black": ($black, $white),
    "light": ($light, $light-invert),
    "dark": ($dark, $dark-invert),
    "primary": ($primary, $primary-invert),
    "info": ($info, $info-invert),
    "success": ($success, $success-invert),
    "warning": ($warning, $warning-invert),
    "danger": ($danger, $danger-invert),
    "twitter": ($twitter, $twitter-invert)
);

// Links
$link: $primary;
$link-invert: $primary-invert;
$link-focus-border: $primary;

// For buefy
$speed-slow: 150ms !default;
$speed-slower: 250ms !default;

// Import Bulma
@import "~bulma/sass/base/_all.sass";

@import "~bulma/sass/form/shared.sass";
@import "~bulma/sass/form/input-textarea.sass";
@import "~bulma/sass/form/checkbox-radio.sass";
@import "~bulma/sass/form/tools.sass";

@import "~bulma/sass/elements/box.sass";
@import "~bulma/sass/elements/button.sass";
@import "~bulma/sass/elements/container.sass";
@import "~bulma/sass/elements/content.sass";
@import "~bulma/sass/elements/icon.sass";
@import "~bulma/sass/elements/progress.sass";
@import "~bulma/sass/elements/table.sass";
@import "~bulma/sass/elements/tag.sass";

@import "~bulma/sass/components/card.sass";
@import "~bulma/sass/components/navbar.sass";

// Import Buefy
@import "~buefy/src/scss/utils/_animations.scss";
@import "~buefy/src/scss/utils/_functions.scss";

@import "~buefy/src/scss/components/_checkbox.scss";

@import "~buefy/src/scss/components/_notices.scss";
@import "~buefy/src/scss/components/_progress.scss";

@import "~bulma/sass/components/tabs.sass";
@import "~buefy/src/scss/components/_tabs.scss";

@import "~buefy/src/scss/components/_table.scss";

@import "~buefy/src/scss/components/_tooltip.scss";
@import "~buefy/src/scss/components/_upload.scss";

.slide-fade-enter-active {
  transition: all .3s ease;
}
.slide-fade-leave-active {
  transition: all .2s cubic-bezier(1.0, 0.5, 0.8, 1.0);
}
.slide-fade-enter, .slide-fade-leave-to {
  transform: translateX(10px);
  opacity: 0;
  position: absolute;
  left: 0;
  right: 0;
}

.network-failed-banner {
  background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%);
  border-bottom: 1px solid #ffc107;
  padding: 0.75rem 1rem;
  position: relative;
  z-index: 30;
}
.network-failed-banner .container {
  max-width: 900px;
  margin: 0 auto;
}
.network-failed-banner .field.has-addons {
  margin: 0.5rem 0;
}
.network-failed-banner .help {
  margin-top: 0.25rem;
}
</style>
