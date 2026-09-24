import { Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'

import { EmailSendError, type MailMessage } from './types'

/**
 * Minimális SMTP provider (T-018).
 *
 * A repo szabályai szerint nem adható hozzá új dependency (pl. nodemailer),
 * ezért a tranzakciós e-mailekhez szükséges SMTP-részhalmaz itt van
 * implementálva: implicit TLS (465) vagy STARTTLS (587/25), AUTH LOGIN,
 * multipart/alternative (text+html) üzenet UTF-8 kódolással, melléklet esetén
 * multipart/mixed burokban.
 *
 * Retry-szabály: az SMTP 4xx válaszkódok átmenetiek (újrapróbálható), az 5xx
 * végleges; a hálózati hibák/timeout újrapróbálhatók, AMÍG a levél tartalma
 * nem indult el. A DATA-blokk elküldése után a megszakadt kapcsolat vagy az
 * elmaradt válasz BIZONYTALAN kézbesítés (`deliveryUncertain`, nem
 * újrapróbálható): a szerver a lezáró pont után már átvehette a levelet, csak
 * a „250” válasza veszett el, így az újraküldés kettőzné a levelet (RFC 1047,
 * „Duplicate messages and SMTP”; RFC 5321 4.1.1.4: a lezáró pont utáni „250”
 * jelzi az átvételt). Az SMTP-nek nincs a Resend idempotencia-kulcsához
 * hasonló ismétlésszűrője. Ha a szerver a tartalomra kifejezett 4xx-szel
 * felel, a levelet NEM vette át, az újrapróbálható marad.
 */

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
  fromAddress: string
}

const SMTP_TIMEOUT_MS = 15_000

type SmtpSocket = Socket

class SmtpProtocolError extends EmailSendError {
  readonly code: number

  constructor(code: number, message: string) {
    super(`SMTP ${code}: ${message}`, code >= 400 && code < 500)
    this.code = code
  }
}

/** A tesztek miatt exportált tiszta segéd (RFC 2047 encoded-word). */
export function encodeWord(value: string): string {
  // RFC 2047 encoded-word a nem-ASCII (magyar ékezetes) subject/feladónév miatt.
  if (!/[^\x20-\x7E]/.test(value) && value.length <= 64) {
    return value
  }
  // 39 UTF-8 bájt -> legfeljebb 64 karakteres encoded-word. Így a Subject:
  // prefix is elfér a 76-os fejlécsorban. Kódpontot nem vágunk ketté, mert
  // minden encoded-wordnek önállóan is dekódolhatónak kell lennie.
  const words: string[] = []
  let chunk = ''
  let bytes = 0
  for (const character of value) {
    const length = Buffer.byteLength(character, 'utf8')
    if (bytes + length > 39) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += length
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
  return words.join(' ')
}

/** RFC 2045: kizárólag a kódolt sorokat törjük; a dekódolt törzsbájtok megmaradnak. */
function encodeMimeBody(value: string): string {
  return (
    Buffer.from(value, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? ''
  )
}

/** Csak a már szűrt érték szóközein hajtogat; címbe vagy encoded-wordbe nem vág. */
function foldHeader(field: string, value: string): string {
  const prefix = `${field}: `
  const lines: string[] = []
  let line = prefix
  let whitespace = ''
  for (const token of value.match(/ +|[^ ]+/g) ?? []) {
    if (token.startsWith(' ')) {
      whitespace += token
      continue
    }
    if (line !== prefix && Buffer.byteLength(line + whitespace + token) > 76) {
      lines.push(line)
      line = whitespace + token
    } else {
      line += whitespace + token
    }
    whitespace = ''
  }
  return [...lines, line + whitespace].join('\r\n')
}

/** A tesztek miatt exportált tiszta segéd (dot-stuffing a DATA-blokkban). */
export function dotStuff(body: string): string {
  return body.replace(/\r\n\./g, '\r\n..')
}

const HEADER_BREAK_PATTERN = /[\u0000-\u001F\u007F]+/g

export function stripHeaderBreaks(value: string): string {
  return value.replace(HEADER_BREAK_PATTERN, ' ').trim()
}

export function formatFromHeader(from: string): string {
  const sanitized = stripHeaderBreaks(from)
  const match = /^(.*)<([^<>]*)>$/.exec(sanitized)
  if (match === null) {
    return sanitized.includes('@') ? sanitized : encodeWord(sanitized)
  }
  const name = match[1]
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
  const address = match[2].trim()
  return name.length > 0 ? `${encodeWord(name)} <${address}>` : `<${address}>`
}

/**
 * A melléklet fájlneve a fejlécben: csak ASCII betű, szám, pont, kötőjel és
 * aláhúzás maradhat. Így idézőjel, sortörés vagy nem-ASCII karakter nem
 * törheti meg a `Content-Disposition` fejlécet (RFC 2183), és RFC 2231
 * szerinti kódolás sem kell.
 */
export function safeAttachmentFilename(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe.length > 0 ? safe : 'melleklet'
}

/**
 * A tesztek miatt exportált üzenet-összeállító (base64 részekkel).
 *
 * Melléklet nélkül multipart/alternative (text+html), pontosan a korábbi
 * alakban. Melléklettel multipart/mixed (RFC 2046, 5.1.3): az első része a
 * változatlan text+html alternatíva, utána a mellékletek.
 */
export function buildMessage(config: SmtpConfig, message: MailMessage): string {
  const stamp = Date.now().toString(36)
  const boundary = `----kineticare-${stamp}`
  // A két határoló egyike sem előtagja a másiknak (RFC 2046, 5.1.1).
  const mixedBoundary = `----kineticare-m-${stamp}`
  const attachments = message.attachments ?? []
  const textPart = encodeMimeBody(message.text)
  const htmlPart = encodeMimeBody(message.html)
  const alternativeContentType = `Content-Type: multipart/alternative; boundary="${boundary}"`
  const headers = [
    foldHeader('From', formatFromHeader(config.from)),
    foldHeader('To', message.to.map(stripHeaderBreaks).join(', ')),
    foldHeader('Subject', encodeWord(stripHeaderBreaks(message.subject))),
    ...(message.replyTo ? [foldHeader('Reply-To', stripHeaderBreaks(message.replyTo))] : []),
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    attachments.length > 0
      ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
      : alternativeContentType,
  ]
  const alternativeBody = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textPart,
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlPart,
    `--${boundary}--`,
  ]
  if (attachments.length === 0) {
    return [...headers, '', ...alternativeBody, ''].join('\r\n')
  }
  const attachmentParts = attachments.flatMap((attachment) => {
    const filename = safeAttachmentFilename(attachment.filename)
    return [
      `--${mixedBoundary}`,
      `Content-Type: ${stripHeaderBreaks(attachment.contentType)}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      encodeMimeBody(attachment.content),
    ]
  })
  return [
    ...headers,
    '',
    `--${mixedBoundary}`,
    alternativeContentType,
    '',
    ...alternativeBody,
    ...attachmentParts,
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')
}

class SmtpSession {
  private socket: SmtpSocket
  private buffer = ''

  private constructor(socket: SmtpSocket) {
    this.socket = socket
  }

  static async connect(config: SmtpConfig): Promise<SmtpSession> {
    const implicitTls = config.port === 465
    const socket = await new Promise<SmtpSocket>((resolve, reject) => {
      const onError = (error: Error) =>
        reject(new EmailSendError(`SMTP kapcsolódás sikertelen: ${error.message}`, true))
      const opened: SmtpSocket = implicitTls
        ? connectTls({ host: config.host, port: config.port, servername: config.host }, () => {
            opened.off('error', onError)
            opened.setTimeout(0)
            resolve(opened)
          })
        : new Socket().connect(config.port, config.host, () => {
            opened.off('error', onError)
            opened.setTimeout(0)
            resolve(opened)
          })
      opened.setTimeout(SMTP_TIMEOUT_MS, () => {
        opened.destroy(new EmailSendError('SMTP időtúllépés a kapcsolódáskor', true))
      })
      opened.once('error', onError)
    })
    return new SmtpSession(socket)
  }

  close(): void {
    this.socket.destroy()
  }

  private readReply(): Promise<{ code: number; lines: string[] }> {
    return new Promise((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        this.buffer += chunk.toString('utf8')
        const reply = this.tryParseReply()
        if (reply) {
          cleanup()
          resolve(reply)
        }
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error instanceof EmailSendError ? error : new EmailSendError(error.message, true))
      }
      const onTimeout = () => {
        cleanup()
        reject(new EmailSendError('SMTP időtúllépés válaszra várva', true))
      }
      // A szerver válasz nélkül is bonthatja a kapcsolatot (FIN, hiba-esemény
      // nélkül). Lezárt socketen az időtúllépés sem fut le, ezért e nélkül a
      // várakozás soha nem érne véget.
      const onClose = () => {
        cleanup()
        reject(new EmailSendError('az SMTP-kapcsolat válasz nélkül lezárult', true))
      }
      const cleanup = () => {
        this.socket.off('data', onData)
        this.socket.off('error', onError)
        this.socket.off('timeout', onTimeout)
        this.socket.off('close', onClose)
      }
      if (this.socket.destroyed) {
        reject(new EmailSendError('az SMTP-kapcsolat válasz nélkül lezárult', true))
        return
      }
      this.socket.on('data', onData)
      this.socket.once('error', onError)
      this.socket.once('close', onClose)
      this.socket.setTimeout(SMTP_TIMEOUT_MS, onTimeout)
      // Lehet, hogy a válasz már a bufferben van (pl. TLS-újrakötés után).
      const ready = this.tryParseReply()
      if (ready) {
        cleanup()
        resolve(ready)
      }
    })
  }

  private tryParseReply(): { code: number; lines: string[] } | null {
    const lines = this.buffer.split('\r\n')
    const collected: string[] = []
    let code = 0
    for (const line of lines.slice(0, -1)) {
      collected.push(line)
      const match = /^(\d{3})([ -])/.exec(line)
      if (match) {
        code = Number(match[1])
        if (match[2] === ' ') {
          this.buffer = this.buffer.slice(collected.join('\r\n').length + 2)
          return { code, lines: collected }
        }
      }
    }
    return null
  }

  private async command(line: string, expected: number[]): Promise<string[]> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()))
    })
    const reply = await this.readReply()
    if (!expected.includes(reply.code)) {
      throw new SmtpProtocolError(reply.code, reply.lines.join(' | ').slice(0, 200))
    }
    return reply.lines
  }

  /** SMTP-párbeszéd: greeting → (STARTTLS) → (AUTH) → MAIL/RCPT/DATA → QUIT. */
  async send(config: SmtpConfig, message: MailMessage, upgradeToTls: () => Promise<void>) {
    await this.expectGreeting()
    const ehloLines = await this.command(`EHLO ${config.host}`, [250])
    const supportsStartTls = ehloLines.some((line) => /STARTTLS/i.test(line))
    if (config.port !== 465) {
      // STARTTLS KÖTELEZŐ a nem-465-ös porton: a szerver-hirdetés hiányában a
      // hitelesítés TITKOSÍTATLAN csatornán menne ki — ezt a folyamat nem
      // folytathatja (a 465-ös implicit TLS ettől független).
      if (!supportsStartTls) {
        throw new EmailSendError(
          'Az SMTP-szerver nem hirdet STARTTLS-t, implicit TLS (465) pedig nincs beállítva — ' +
            'a hitelesítés titkosítatlan csatornán NEM küldhető. Állíts be TLS-támogatást a szerveren, ' +
            'használd a 465-ös implicit TLS-portot, vagy válts Resend-providerre.',
          false,
        )
      }
      await this.command('STARTTLS', [220])
      await upgradeToTls()
      await this.command(`EHLO ${config.host}`, [250])
    }
    if (config.user) {
      await this.command('AUTH LOGIN', [334])
      await this.command(Buffer.from(config.user, 'utf8').toString('base64'), [334])
      await this.command(Buffer.from(config.pass ?? '', 'utf8').toString('base64'), [235])
    }
    await this.command(`MAIL FROM:<${stripHeaderBreaks(config.fromAddress)}>`, [250])
    for (const recipient of message.to) {
      await this.command(`RCPT TO:<${stripHeaderBreaks(recipient)}>`, [250, 251])
    }
    await this.command('DATA', [354])
    const data = `${dotStuff(buildMessage(config, message))}\r\n.\r\n`
    let reply: { code: number; lines: string[] }
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket.write(data, (error) => (error ? reject(error) : resolve()))
      })
      reply = await this.readReply()
    } catch (error) {
      // A tartalom (a lezáró ponttal együtt) már úton lehetett: a szerver
      // átvehette, csak a válasza nem ért ide. Lásd a fájl fejlécét.
      throw new EmailSendError(
        'SMTP: a levél tartalmának átadása után megszakadt a kapcsolat, a kézbesítés ' +
          `bizonytalan (${error instanceof Error ? error.message : String(error)})`,
        false,
        { deliveryUncertain: true },
      )
    }
    if (reply.code !== 250) {
      throw new SmtpProtocolError(reply.code, reply.lines.join(' | ').slice(0, 200))
    }
    await this.command('QUIT', [221]).catch(() => undefined)
  }

  private async expectGreeting(): Promise<void> {
    const reply = await this.readReply()
    if (reply.code !== 220) {
      throw new SmtpProtocolError(reply.code, reply.lines.join(' | ').slice(0, 200))
    }
  }

  private wrapWithTls(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tlsSocket = connectTls({ socket: this.socket, servername: host }, () => {
        this.socket = tlsSocket
        this.buffer = ''
        resolve()
      })
      tlsSocket.once('error', (error) =>
        reject(new EmailSendError(`SMTP STARTTLS sikertelen: ${error.message}`, true)),
      )
    })
  }

  async sendWithUpgrade(config: SmtpConfig, message: MailMessage): Promise<void> {
    await this.send(config, message, () => this.wrapWithTls(config.host))
  }
}

export async function sendViaSmtp(config: SmtpConfig, message: MailMessage): Promise<void> {
  const session = await SmtpSession.connect(config)
  try {
    await session.sendWithUpgrade(config, message)
  } finally {
    session.close()
  }
}
