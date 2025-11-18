import WhatsAppChat from "../components/sections/whatsapp/chat";

export default function ChatPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <WhatsAppChat contactName="Club Cash In" contactSubtitle="online" />
    </div>
  );
}
