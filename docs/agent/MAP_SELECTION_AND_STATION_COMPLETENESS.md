# Map selection and station completeness

## Applied versions

- `13.98.0`: Web highlight and label rendering correction
- `13.99.0`: Editor station hit-test correction at collapsed transfer zoom
- `14.0.0`: Branch-only station visibility and serving-line completeness

## Web rendering policy

- Base line casing is disabled so faded lines do not retain a white outline.
- Non-context lines use very low opacity instead of being removed.
- Station fill, casing and stroke opacity change together.
- The normal station label excludes emphasized stations; selected and route stations use only the emphasized label layer.
- Clicking map background clears line, branch, station, transfer-group and route selection state.

## Branch-only stations

Stations referenced only by a manual line-branch override are included in:

- visible map station IDs
- marker rendering
- station color resolution
- station serving-line summaries
- station detail route-section counts

The parent branch supplies the line name and color for an override-only station.

## Editor hit testing

The station hit layers are queried at every zoom level. Collapsed transfer rendering changes only how transfer groups are drawn; it no longer removes ordinary station hit testing. Station hits are resolved before transfer-group and line hits.
