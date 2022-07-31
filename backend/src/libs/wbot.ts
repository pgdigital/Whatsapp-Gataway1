import makeWASocket, {
  AnyWASocket,
  AuthenticationState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  LegacyAuthenticationCreds,
  makeInMemoryStore,
  makeWALegacySocket
} from "@adiwajshing/baileys";

import { Boom } from "@hapi/boom";
import MAIN_LOGGER from "@adiwajshing/baileys/lib/Utils/logger";
import Whatsapp from "../models/Whatsapp";
import { logger } from "../utils/logger";
import authStateLegacy from "../helpers/authStateLegacy";
import authState from "../helpers/authState";
import AppError from "../errors/AppError";
import { getIO } from "./socket";
import { Store } from "./store";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import DeleteBaileysService from "../services/BaileysServices/DeleteBaileysService";

const loggerBaileys = MAIN_LOGGER.child({});
loggerBaileys.level = "error";

type Session = AnyWASocket & {
  id?: number;
  store?: Store;
};

const sessions: Session[] = [];

const retriesQrCodeMap = new Map<number, number>();

export const getWbot = (whatsappId: number): Session => {
  const sessionIndex = sessions.findIndex(s => s.id === whatsappId);

  if (sessionIndex === -1) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  return sessions[sessionIndex];
};

export const removeWbot = async (
  whatsappId: number,
  isLogout = true
): Promise<void> => {
  try {
    const sessionIndex = sessions.findIndex(s => s.id === whatsappId);
    if (sessionIndex !== -1) {
      if (isLogout) {
        sessions[sessionIndex].logout();
        sessions[sessionIndex].ws.close();
      }

      sessions.splice(sessionIndex, 1);
    }
  } catch (err) {
    logger.error(err);
  }
};

export const initWbot = async (whatsapp: Whatsapp): Promise<Session> => {
  return new Promise((resolve, reject) => {
    try {
      (async () => {
        const io = getIO();

        const whatsappUpdate = await Whatsapp.findOne({
          where: { id: whatsapp.id }
        });

        if (!whatsappUpdate) return;

        const { id, name, isMultidevice } = whatsappUpdate;
        const { version, isLatest } = await fetchLatestBaileysVersion();

        logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);
        logger.info(`isMultidevice: ${isMultidevice}`);
        logger.info(`Starting session ${name}`);
        let retriesQrCode = 0;

        let wsocket: Session = null;
        const store = makeInMemoryStore({
          logger: loggerBaileys
        });

        const { state, saveState } = isMultidevice
          ? await authState(whatsapp)
          : await authStateLegacy(whatsapp);

        wsocket = isMultidevice
          ? makeWASocket({
              logger: loggerBaileys,
              printQRInTerminal: false,
              auth: state as AuthenticationState,
              version
            })
          : makeWALegacySocket({
              logger: loggerBaileys,
              printQRInTerminal: false,
              auth: state as LegacyAuthenticationCreds,
              version
            });

        wsocket.ev.on(
          "connection.update",
          async ({ connection, lastDisconnect, qr }) => {
            logger.info(
              `Socket  ${name} Connection Update ${connection || ""} ${
                lastDisconnect || ""
              }`
            );

            const disconect = (lastDisconnect?.error as Boom)?.output
              ?.statusCode;

            if (connection === "close") {
              if (disconect === 403) {
                await whatsapp.update({ status: "PENDING", session: "" });
                await DeleteBaileysService(whatsapp.id);
                io.emit("whatsappSession", {
                  action: "update",
                  session: whatsapp
                });
                removeWbot(id, false);
              }

              if (disconect !== DisconnectReason.loggedOut) {
                removeWbot(id, false);
                setTimeout(() => StartWhatsAppSession(whatsapp), 2000);
              } else {
                await whatsapp.update({ status: "PENDING", session: "" });
                await DeleteBaileysService(whatsapp.id);

                io.emit("whatsappSession", {
                  action: "update",
                  session: whatsapp
                });
                removeWbot(id, false);
                setTimeout(() => StartWhatsAppSession(whatsapp), 2000);
              }
            }

            if (connection === "open") {
              await whatsapp.update({
                status: "CONNECTED",
                qrcode: "",
                retries: 0
              });

              io.emit("whatsappSession", {
                action: "update",
                session: whatsapp
              });

              const sessionIndex = sessions.findIndex(
                s => s.id === whatsapp.id
              );
              if (sessionIndex === -1) {
                wsocket.id = whatsapp.id;
                sessions.push(wsocket);
              }

              resolve(wsocket);
            }

            if (qr !== undefined) {
              if (retriesQrCodeMap.get(id) && retriesQrCodeMap.get(id) >= 3) {
                await whatsappUpdate.update({
                  status: "DISCONNECTED",
                  qrcode: ""
                });
                await DeleteBaileysService(whatsappUpdate.id);
                io.emit("whatsappSession", {
                  action: "update",
                  session: whatsappUpdate
                });
                wsocket.ev.removeAllListeners("connection.update");
                wsocket.ws.close();
                wsocket = null;
                retriesQrCodeMap.delete(id);
              } else {
                logger.info(`Session QRCode Generate ${name}`);
                retriesQrCodeMap.set(id, (retriesQrCode += 1));

                await whatsapp.update({
                  qrcode: qr,
                  status: "qrcode",
                  retries: 0
                });
                const sessionIndex = sessions.findIndex(
                  s => s.id === whatsapp.id
                );

                if (sessionIndex === -1) {
                  wsocket.id = whatsapp.id;
                  sessions.push(wsocket);
                }

                io.emit("whatsappSession", {
                  action: "update",
                  session: whatsapp
                });
              }
            }
          }
        );
        wsocket.ev.on("creds.update", saveState);

        wsocket.store = store;
        store.bind(wsocket.ev);
      })();
    } catch (error) {
      console.log(error);
      reject(error);
    }
  });
};
