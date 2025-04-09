import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} from '@whiskeysockets/baileys';

import pino from 'pino';
import moment from 'moment-timezone';
import fs from 'fs';

// Mapas de controle de interações
const lastInteraction = new Map();
const pendingReminders = new Map();

// Variável global do socket
let sock;

const startSock = async () => {
    console.log('🔄 Iniciando o socket...');

    const { state, saveCreds } = await useMultiFileAuthState('./sessions');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'info' })
    });

    console.log('📡 Socket criado.');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📲 Escaneie o QR code acessando o link abaixo:\n');
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }

        if (connection === 'connecting') {
            console.log('🔌 Conectando...');
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso!');
        } else if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão encerrada.', shouldReconnect ? 'Tentando reconectar...' : 'Sessão encerrada.');
            if (shouldReconnect) startSock();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
        const nome = msg.pushName || "cliente";

        lastInteraction.set(from, moment().tz('America/Sao_Paulo'));
        pendingReminders.delete(from);

        if (/menu|oi|olá|ola|bom dia|boa/i.test(body)) {
            await sock.sendMessage(from, {
                text: `Olá, ${nome.split(" ")[0]}! 👋 A *Barão Parts* agradece seu contato!\n\nEscolha abaixo o tipo de veículo para o qual você deseja peças:\n\n1 - Trator\n2 - Ônibus\n3 - Marruá\n4 - Caminhão\n5 - Gerador\n6 - Outras perguntas`
            });

            const reminderTime = moment().tz('America/Sao_Paulo').add(3, 'hours');
            pendingReminders.set(from, reminderTime);
        }

        if (['1', '2', '3', '4', '5', '6'].includes(body.trim())) {
            await sock.sendMessage(from, {
                text: '👍 Para agilizar, envie o *nome da peça*, *código* ou *chassi* do veículo.'
            });
        }

        if (/peça|marca|chassi/i.test(body)) {
            await sock.sendMessage(from, {
                text: '📨 Um atendente dará sequência ao seu atendimento em breve.'
            });
        }

        if (body.trim() === '1') {
            await sock.sendMessage(from, {
                text: `🙏 Obrigado por responder!\n\nVocê pode avaliar nosso atendimento aqui:\n👉 https://docs.google.com/forms/d/e/1FAIpQLScV1F8hr-hZK6GvzrkRfq_wxsanuAuGAAmcwKue1Sxf4hMJ1A/viewform?usp=sharing`
            });
        } else if (body.trim() === '2') {
            await sock.sendMessage(from, {
                text: `💬 Como podemos te ajudar?\n\n1 - Trator\n2 - Ônibus\n3 - Marruá\n4 - Caminhão\n5 - Gerador\n6 - Outras perguntas`
            });
        }
    });

    return sock;
};

// Verifica lembretes e inatividade a cada hora
setInterval(async () => {
    if (!sock) return;

    const now = moment().tz('America/Sao_Paulo');

    for (let [user, reminderTime] of pendingReminders.entries()) {
        if (now.isSameOrAfter(reminderTime)) {
            await sock.sendMessage(user, {
                text: `👋 Olá! Só passando para lembrar que ainda estamos aqui caso precise de ajuda. Fico no aguardo da sua resposta! 🙂`
            });
            pendingReminders.delete(user);
        }
    }

    for (let [user, lastTime] of lastInteraction.entries()) {
        if (now.diff(lastTime, 'days') >= 3) {
            await sock.sendMessage(user, {
                text: `📌 Posso finalizar o seu atendimento?\n\n1 - Sim\n2 - Não`
            });
            lastInteraction.delete(user);
            pendingReminders.delete(user);
        }
    }
}, 1000 * 60 * 60); // a cada hora

// Inicia o bot
startSock();
