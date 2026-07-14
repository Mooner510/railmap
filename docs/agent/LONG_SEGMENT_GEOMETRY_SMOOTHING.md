# Long segment geometry smoothing

Long station-to-station sections now continue increasing their render-only sample density instead of stopping at a small per-segment cap.

- Editable station and control-point coordinates remain exact anchors.
- Long sections use tighter target spacing and a distance-based density boost.
- Curved sections still receive additional curvature samples.
- Render-only points are capped globally and per segment to prevent unbounded MapLibre cost.
- Stored manual geometry is unchanged; only the displayed polyline is densified.
