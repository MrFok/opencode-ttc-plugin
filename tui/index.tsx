/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiTheme } from "@opencode-ai/plugin/tui";
import {
  emptySidebarStateText,
  formatMetricValue,
  formatPartLine,
  getStatusDotColor,
  loadAuthStatus,
  loadSidebarState,
  shouldRenderSidebarState,
  statusText
} from "./sidebar-state.js";
import { registerTtcSettingsCommand } from "./settings.js";

type SidebarState = Awaited<ReturnType<typeof loadSidebarState>>;
type AuthStatus = Awaited<ReturnType<typeof loadAuthStatus>>;

function SidebarContent(props: {
  api: TuiPluginApi;
  sessionID: string;
  theme: TuiTheme;
}) {
  const [state, setState] = createSignal<SidebarState>(null);
  const [loadedSessionID, setLoadedSessionID] = createSignal("");
  const [loadingSessionID, setLoadingSessionID] = createSignal("");
  const [authStatus, setAuthStatus] = createSignal<AuthStatus>({ hasKey: false, providerID: null, authPath: "" });
  const [refreshCount, setRefreshCount] = createSignal(0);
  const theme = () => props.theme.current;

  const refresh = async (sessionID = props.sessionID) => {
    setLoadingSessionID(sessionID);
    const [nextState, nextAuthStatus] = await Promise.all([
      loadSidebarState(sessionID),
      loadAuthStatus()
    ]);

    if (props.sessionID !== sessionID) return;
    setState(nextState);
    setLoadedSessionID(sessionID);
    setAuthStatus(nextAuthStatus);
    setLoadingSessionID("");
  };

  createEffect(() => {
    const sessionID = props.sessionID;
    refreshCount();
    void refresh(sessionID);
  });

  const triggerRefresh = (event: { properties?: Record<string, unknown> }) => {
    const eventSessionID = event.properties?.sessionID;
    if (typeof eventSessionID === "string" && eventSessionID !== props.sessionID) return;
    setRefreshCount((count) => count + 1);
  };

  const unsubscribeMessageUpdated = props.api.event.on("message.updated", triggerRefresh);
  const unsubscribeSessionStatus = props.api.event.on("session.status", triggerRefresh);
  const poll = setInterval(() => setRefreshCount((count) => count + 1), 2000);

  onCleanup(() => {
    clearInterval(poll);
    unsubscribeMessageUpdated();
    unsubscribeSessionStatus();
  });

  const sessionMessageCount = createMemo(() => props.api.state.session.messages(props.sessionID)?.length ?? 0);

  const hasAuth = createMemo(() => authStatus().hasKey);

  const visibleState = createMemo(() => {
    if (!hasAuth()) {
      return null; // hide any stale compressed/skipped state once logged out
    }
    return shouldRenderSidebarState(state(), loadedSessionID(), props.sessionID) ? state() : null;
  });

  const isLoadingCurrentSession = createMemo(() => loadingSessionID() === props.sessionID && !visibleState());

  const effectiveStatus = createMemo(() => {
    if (!hasAuth()) {
      return "missing_auth";
    }
    const current = visibleState();
    if (current?.status === "missing_auth" && hasAuth()) {
      return "waiting";
    }
    return current?.status;
  });

  const dotColor = createMemo(() => {
    return getStatusDotColor(effectiveStatus(), theme());
  });

  const statusLine = createMemo(() => {
    const current = visibleState();
    if (!current) {
      if (!hasAuth()) {
        return "missing TTC auth";
      }
      return emptySidebarStateText({
        loading: isLoadingCurrentSession(),
        messageCount: sessionMessageCount()
      });
    }
    if (effectiveStatus() === "waiting") {
      return "authenticated — send a message to start compressing";
    }
    return statusText(current);
  });

  return (
    <box gap={0} paddingRight={1}>
      <box flexDirection="row" gap={0}>
        <text fg={dotColor()}>● </text>
        <text fg={theme().text}>Token Compression </text>
        <text fg={theme().textMuted}>{visibleState()?.config?.model ?? ""}</text>
      </box>
      <text fg={theme().textMuted}>{statusLine()}</text>
      <Show when={visibleState()} fallback={<text fg={theme().textMuted}>No metrics for this session yet</text>}>
        {(current) => (
          <box gap={0}>
            <box flexDirection="row" gap={0}>
              <text fg={theme().textMuted}>Last prompt: </text>
              <text fg={theme().textMuted}>
                {formatMetricValue(current().lastMessage.charsAfter, current().lastMessage.charsBefore)}
              </text>
            </box>
            <box flexDirection="row" gap={0}>
              <text fg={theme().textMuted}>Session: </text>
              <text fg={theme().textMuted}>
                {formatMetricValue(current().session.charsAfter, current().session.charsBefore)}
              </text>
            </box>
            <text fg={theme().textMuted}>{formatPartLine(current().session)}</text>
          </box>
        )}
      </Show>
    </box>
  );
}

const tui: TuiPlugin = async (api) => {
  registerTtcSettingsCommand(api);

  api.slots.register({
    order: 350,
    slots: {
      sidebar_content: (_ctx, props) => (
        <SidebarContent api={api} sessionID={props.session_id} theme={api.theme} />
      )
    }
  });
};

export default {
  id: "opencode-ttc-plugin",
  tui
};
