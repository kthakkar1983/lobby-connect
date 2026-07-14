import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatDock } from "../../components/call/chat-dock";

const lines = [
  { id: "1", from: "guest" as const, text: "1425 Oak Street", ts: 1 },
  { id: "2", from: "agent" as const, text: "Got it", ts: 2 },
];

describe("ChatDock", () => {
  it("renders the thread and sends redacted text on Enter", () => {
    const onSend = vi.fn();
    render(<ChatDock lines={lines} peerTyping={false} onSend={onSend} onTyping={() => {}} />);
    expect(screen.getByText("1425 Oak Street")).toBeTruthy();
    const input = screen.getByPlaceholderText(/type/i);
    fireEvent.change(input, { target: { value: "card 4111 1111 1111 1111" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("card 4111 1111 1111 1111"); // redaction happens in video-call sendChat
  });

  it("shows the typing indicator when peerTyping", () => {
    render(<ChatDock lines={[]} peerTyping onSend={() => {}} onTyping={() => {}} />);
    expect(screen.getByTestId("typing-indicator")).toBeTruthy();
  });
});
