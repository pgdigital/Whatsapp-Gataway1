import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap
} from "@adiwajshing/baileys";
import { BufferJSON, initAuthCreds, proto } from "@adiwajshing/baileys";
import * as Sentry from "@sentry/node";

import Whatsapp from "../models/Whatsapp";

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
  "pre-key": "preKeys",
  session: "sessions",
  "sender-key": "senderKeys",
  "app-state-sync-key": "appStateSyncKeys",
  "app-state-sync-version": "appStateVersions",
  "sender-key-memory": "senderKeyMemory"
};

const authState = async (
  whatsapp: Whatsapp
): Promise<{ state: AuthenticationState; saveState: () => void }> => {
  let creds: AuthenticationCreds;
  let keys: any = {};

  const saveState = async () => {
    try {
      whatsapp.update({
        session: JSON.stringify({ creds, keys }, BufferJSON.replacer, 0)
      });
    } catch (error) {
      Sentry.captureException(error);
    }
  };

  if (whatsapp.session && whatsapp.session !== null) {
    const result = JSON.parse(whatsapp.session, BufferJSON.reviver);
    creds = result.creds;
    keys = result.keys;
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const key = KEY_MAP[type];
          return ids.reduce((dict: any, id) => {
            let value = keys[key]?.[id];
            if (value) {
              if (type === "app-state-sync-key") {
                value = proto.AppStateSyncKeyData.fromObject(value);
              }
              dict[id] = value;
            }
            return dict;
          }, {});
        },
        set: (data: any) => {
          Object.keys(data).forEach(key => {
            const keyNew = KEY_MAP[key as keyof SignalDataTypeMap];
            keys[keyNew] = keys[keyNew] || {};

            Object.assign(keys[keyNew], data[key]);
          });
          saveState();
        }
      }
    },
    saveState
  };
};

export default authState;
