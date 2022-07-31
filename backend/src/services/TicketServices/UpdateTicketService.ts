import { isNil } from "lodash";
import CheckContactOpenTickets from "../../helpers/CheckContactOpenTickets";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import SetTicketMessagesAsRead from "../../helpers/SetTicketMessagesAsRead";
import { getIO } from "../../libs/socket";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import ShowTicketService from "./ShowTicketService";

interface TicketData {
  status?: string;
  userId?: number;
  queueId?: number;
  whatsappId?: number;
}

interface Request {
  ticketData: TicketData;
  ticketId: string | number;
}

interface Response {
  ticket: Ticket;
  oldStatus: string;
  oldUserId: number | undefined;
}

const UpdateTicketService = async ({
  ticketData,
  ticketId
}: Request): Promise<Response> => {
  const { status, userId, queueId, whatsappId } = ticketData;

  const ticket = await ShowTicketService(ticketId);
  await SetTicketMessagesAsRead(ticket);

  if (whatsappId && ticket.whatsappId !== whatsappId) {
    await CheckContactOpenTickets(ticket.contactId, whatsappId);
  }

  const oldStatus = ticket.status;
  const oldUserId = ticket.user?.id;
  const oldQueueId = ticket.queueId;

  if (oldStatus === "closed") {
    await CheckContactOpenTickets(ticket.contact.id, ticket.whatsappId);
  }

  if (oldQueueId !== queueId && !isNil(oldQueueId) && !isNil(queueId)) {
    const whatsapp = await Whatsapp.findOne({
      where: { id: ticket.whatsappId }
    });
    const wbot = await GetTicketWbot(ticket);

    const newMessage = whatsapp?.transferTicketMessage.replace(
      "{{fila}}",
      ticket.queue.name
    );

    await wbot.sendMessage(
      `${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      {
        text: `\u200e${newMessage}`
      }
    );
  }

  await ticket.update({
    status,
    queueId,
    userId
  });

  if (whatsappId) {
    await ticket.update({
      whatsappId
    });
  }

  await ticket.reload();

  const io = getIO();

  if (ticket.status !== oldStatus || ticket.user?.id !== oldUserId) {
    io.to(oldStatus).emit("ticket", {
      action: "delete",
      ticketId: ticket.id
    });
  }

  io.to(ticket.status)
    .to("notification")
    .to(ticketId.toString())
    .emit("ticket", {
      action: "update",
      ticket
    });

  return { ticket, oldStatus, oldUserId };
};

export default UpdateTicketService;
