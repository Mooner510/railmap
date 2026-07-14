# Geometry drag render pipeline

- Pointer movement no longer writes cursor position into React state.
- Geometry drag frames update a dedicated MapLibre preview source directly.
- Editable draft state is committed once on pointer release.
- The preview curve uses a bounded render-only smoothing budget and preserves editable anchors.
- This prevents the map event handler from triggering full editor renders and repeated full branch rebuilds while dragging.
