export interface AutoCoverState {
  enabled: boolean;
  concealed: boolean;
  bookReady: boolean;
  coverReady: boolean;
  importing: boolean;
  coverLoading: boolean;
  coverSettingsOpen: boolean;
  propertiesOpen: boolean;
  imageOpen: boolean;
  dragging: boolean;
}

export function canAutoCoverOnPointerLeave(
  state: AutoCoverState,
  event: Pick<PointerEvent, "pointerType">,
) {
  return (
    event.pointerType === "mouse" &&
    state.enabled &&
    !state.concealed &&
    state.bookReady &&
    state.coverReady &&
    !state.importing &&
    !state.coverLoading &&
    !state.coverSettingsOpen &&
    !state.propertiesOpen &&
    !state.imageOpen &&
    !state.dragging
  );
}
