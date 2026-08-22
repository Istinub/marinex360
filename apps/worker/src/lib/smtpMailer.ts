import { Buffer } from "node:buffer";
import net from "node:net";

export interface Attachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
}

export interface SmtpConfig {
  host: string;
  port: number;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  return {
    host: env.SMTP_HOST ?? "localhost",
    port: Number(env.SMTP_PORT ?? "1025"),
  };
}

function address(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

export function buildMimeMessage(message: MailMessage): string {
  const boundary = `mx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    message.text,
  ];

  for (const attachment of message.attachments ?? []) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      Buffer.from(attachment.content).toString("base64").replace(/(.{76})/g, "$1\r\n"),
    );
  }

  parts.push(`--${boundary}--`, "");
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

function readResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (/^\d{3}[ -]/m.test(text)) {
        cleanup();
        resolve(text);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket: net.Socket, line: string): Promise<void> {
  socket.write(`${line}\r\n`);
  const res = await readResponse(socket);
  if (!/^[23]/.test(res)) throw new Error(`SMTP command failed: ${line}: ${res.trim()}`);
}

export async function sendMail(message: MailMessage, config: SmtpConfig = smtpConfigFromEnv()): Promise<void> {
  const socket = net.createConnection({ host: config.host, port: config.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  try {
    await readResponse(socket);
    await command(socket, "HELO marinex360.local");
    await command(socket, `MAIL FROM:<${address(message.from)}>`);
    await command(socket, `RCPT TO:<${address(message.to)}>`);
    await command(socket, "DATA");
    socket.write(`${buildMimeMessage(message)}\r\n.\r\n`);
    const dataRes = await readResponse(socket);
    if (!/^2/.test(dataRes)) throw new Error(`SMTP DATA failed: ${dataRes.trim()}`);
    await command(socket, "QUIT");
  } finally {
    socket.end();
  }
}
