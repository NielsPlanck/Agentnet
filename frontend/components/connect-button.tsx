"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkConnection, startOAuthFlow, disconnectTool } from "@/lib/connections";
import { Plug, Unplug, Loader2 } from "lucide-react";

interface ConnectButtonProps {
  toolId: string;
  authType: string;
  onConnectionChange?: (connected: boolean) => void;
}

export function ConnectButton({ toolId, authType, onConnectionChange }: ConnectButtonProps) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  const updateConnected = (value: boolean) => {
    setConnected(value);
    onConnectionChange?.(value);
  };

  useEffect(() => {
    if (authType !== "oauth") {
      setLoading(false);
      return;
    }
    checkConnection(toolId).then((status) => {
      updateConnected(status.connected);
      setLoading(false);
    });
  }, [toolId, authType]);

  // Only show for OAuth tools
  if (authType !== "oauth") return null;

  if (loading) {
    return <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-foreground)]" />;
  }

  if (connected) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-[var(--primary)] hover:text-destructive gap-1 group"
        onClick={async () => {
          await disconnectTool(toolId);
          updateConnected(false);
        }}
      >
        <Plug className="h-3 w-3 group-hover:hidden" />
        <Unplug className="h-3 w-3 hidden group-hover:block" />
        <span className="group-hover:hidden">Connected</span>
        <span className="hidden group-hover:inline">Disconnect</span>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-3 text-xs border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--primary)]/10 gap-1"
      onClick={() => startOAuthFlow(toolId)}
    >
      <Plug className="h-3 w-3" />
      Connect
    </Button>
  );
}
