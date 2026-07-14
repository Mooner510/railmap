# Current task

## Applied through

- `13.101.0-13.103.0`

## Completed

- Web background line opacity reduced for selected-line and route-search states
- background stations remain more visible than background lines
- station fill, casing, stroke and label opacity are controlled by one shared policy
- manual line branches follow their parent branch selection and route highlight
- Web MapLibre emphasis expressions extracted from `RailMap.tsx`
- common numeric emphasis policy moved to `packages/ui`
- all faded map features remain interactive through unchanged hit layers

## Next

- split Web map source construction from `RailMap.tsx`
- split Web layer registration and event binding from `RailMap.tsx`
- move shared Editor/Web hit-test priority constants into `packages/ui`
- then split Editor audit, transfer recommendation and timetable import sections
