// Microphone capture for the voice conversation. It runs on the audio thread: it averages the
// microphone down to 16 kHz and hands over 100 ms of 16-bit mono PCM at a time.
//
// This is a real file served from the app's own origin (not an inline blob) because the app's
// Content-Security-Policy only allows scripts from 'self', and audio worklets follow script-src.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.phase = 0
    this.sum = 0
    this.count = 0
    this.out = new Int16Array(1600)
    this.n = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i]
      this.count++
      this.phase += 1
      if (this.phase >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.sum / this.count))
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
        this.sum = 0
        this.count = 0
        this.phase -= this.ratio
        if (this.n === this.out.length) {
          const chunk = this.out.slice(0)
          this.port.postMessage(chunk.buffer, [chunk.buffer])
          this.n = 0
        }
      }
    }
    return true
  }
}

registerProcessor('pcm16-capture', Pcm16Capture)
