/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiTheme } from "@opencode-ai/plugin/tui";
import {
  formatMetricValue,
  formatPartLine,
  getStatusDotColor,
  loadSidebarState,
  statusText
} from "./sidebar-state.js";
import { registerTtcSettingsCommand } from "./settings.js";

type SidebarState = Awaited<ReturnType<typeof loadSidebarState>>;

function SidebarContent(props: {
  api: TuiPluginApi;
  sessionID: string;
  theme: TuiTheme;
}) {
  const [state, setState] = createSignal<SidebarState>(null);
  const [refreshCount, setRefreshCount] = createSignal(0);
  const theme = () => props.theme.current;

  const refresh = async () => {
    setState(await loadSidebarState(props.sessionID));
  };

  createEffect(() => {
    props.sessionID;
    setState(null);
    void refresh();
  });

  createEffect(() => {
    refreshCount();
    void refresh();
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

  const dotColor = createMemo(() => {
    const current = state();
    return getStatusDotColor(current?.status, theme());
  });

  return (
    <box gap={0} paddingRight={1}>
      <box flexDirection="row" gap={0}>
        <text fg={dotColor()}>● </text>
        <text fg={theme().text}>Token Compression </text>
        <text fg={theme().textMuted}>{state()?.config?.model ?? ""}</text>
      </box>
      <text fg={theme().textMuted}>{statusText(state())}</text>
      <Show when={state()} fallback={<text fg={theme().textMuted}>No session data yet</text>}>
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
