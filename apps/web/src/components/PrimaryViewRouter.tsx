import type { ComponentProps } from "react";

import type { PrimaryNavIndex } from "../app/constants";
import { ActivityPrimaryView } from "./ActivityPrimaryView";
import { CanvasPrimaryView } from "./CanvasPrimaryView";
import { CodeIntelPrimaryView } from "./CodeIntelPrimaryView";
import { ConversationsPrimaryView } from "./ConversationsPrimaryView";
import { DeckPrimaryView } from "./DeckPrimaryView";
import { MonitorPrimaryView } from "./MonitorPrimaryView";
import { SettingsPrimaryView } from "./SettingsPrimaryView";

type PrimaryViewRouterProps = {
  activePrimaryNav: PrimaryNavIndex;
  onDeckSidebarContent?: (content: import("react").ReactNode) => void;
  isMonitorVisible: boolean;
  activityPrimaryViewProps: ComponentProps<typeof ActivityPrimaryView>;
  monitorPrimaryViewProps: ComponentProps<typeof MonitorPrimaryView>;
  settingsPrimaryViewProps: ComponentProps<typeof SettingsPrimaryView>;
  conversationsPrimaryViewProps: ComponentProps<typeof ConversationsPrimaryView>;
  canvasPrimaryViewProps: ComponentProps<typeof CanvasPrimaryView>;
};

export const PrimaryViewRouter = ({
  activePrimaryNav,
  onDeckSidebarContent,
  isMonitorVisible,
  activityPrimaryViewProps,
  monitorPrimaryViewProps,
  settingsPrimaryViewProps,
  conversationsPrimaryViewProps,
  canvasPrimaryViewProps,
}: PrimaryViewRouterProps) => {
  if (activePrimaryNav === 2) {
    return <DeckPrimaryView onSidebarContent={onDeckSidebarContent} />;
  }

  if (activePrimaryNav === 3) {
    return <ActivityPrimaryView {...activityPrimaryViewProps} />;
  }

  if (activePrimaryNav === 4) {
    if (isMonitorVisible) {
      return <MonitorPrimaryView {...monitorPrimaryViewProps} />;
    }
    return (
      <section className="monitor-view" aria-label="Monitor primary view disabled">
        <section className="monitor-panel monitor-panel--configure">
          <h3>Monitor is disabled</h3>
          <p>Enable Monitor workspace view in Settings to restore this panel.</p>
        </section>
      </section>
    );
  }

  if (activePrimaryNav === 5) {
    return <ConversationsPrimaryView {...conversationsPrimaryViewProps} />;
  }

  if (activePrimaryNav === 7) {
    return <CodeIntelPrimaryView enabled={activePrimaryNav === 7} />;
  }

  if (activePrimaryNav === 8) {
    return <SettingsPrimaryView {...settingsPrimaryViewProps} />;
  }

  return <CanvasPrimaryView {...canvasPrimaryViewProps} />;
};
