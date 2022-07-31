import {
  BufferJSON,
  LegacyAuthenticationCreds,
  newLegacyAuthCreds
} from "@adiwajshing/baileys";
import Whatsapp from "../models/Whatsapp";

export const authStateLegacy = async (whatsapp: Whatsapp): Promise<any> => {
  let state: LegacyAuthenticationCreds;
  if (whatsapp.session) {
    state = JSON.parse(whatsapp?.session, BufferJSON.reviver);
    if (typeof state.encKey === "string") {
      state.encKey = Buffer.from(state.encKey, "base64");
    }

    if (typeof state.macKey === "string") {
      state.macKey = Buffer.from(state.macKey, "base64");
    }
  } else {
    state = newLegacyAuthCreds();
  }

  return {
    state,
    saveState: async () => {
      const str = JSON.stringify(state, BufferJSON.replacer, 0);
      await whatsapp.update({
        session: str
      });
    }
  };
};

export default authStateLegacy;
