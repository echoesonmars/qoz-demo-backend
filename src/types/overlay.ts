export type StreamOverlayBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  label?: string;
};

export type StreamOverlayMessage = {
  type: "overlay";
  boxes: StreamOverlayBox[];
  caption?: string;
};
