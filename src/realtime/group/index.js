export { attachGroupHandlers } from "./group.controller.js";
export { EVT as GROUP_EVEBTS } from "./group.controller.js";

import { startPlaybackCoordinator } from "./jobs/playback.coordinator.js";
import { startListenersSweeper } from "./jobs/listeners.sweeper.js";

export function initGroupJobs(nsp) {
    startPlaybackCoordinator(nsp);
    startListenersSweeper();
}