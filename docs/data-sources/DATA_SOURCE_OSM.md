# DATA_SOURCE_OSM

Status: locked draft
Generated: 2026-06-19
Source IDs: `osm_geofabrik_south_korea_20260617`, `osm_korea_non_military_20260618`
Scope: railway geometry, station/platform geometry, and OSM railway metadata

## Summary

OSM PBF is accepted as the Stage 2 railway geometry source.

Use Geofabrik South Korea PBF as the primary source. Use OSM Korea non-military PBF as fallback only.

OSM is suitable for:

- active railway line geometry;
- rail/subway/light rail/monorail ways;
- station/platform/stop geometry candidates;
- OSM route relations where present;
- multilingual names if present in tags;
- operator/network/electrification/gauge/maxspeed metadata candidates.

OSM is not sufficient for:

- authoritative static timetable;
- fare rules;
- transfer walking time matrix;
- official final line/station merge decisions;
- planned/construction line source of truth.

## Raw source files

### Primary: Geofabrik

| Field | Value |
|---|---|
| Source ID | `osm_geofabrik_south_korea_20260617` |
| Download URL | `https://download.geofabrik.de/asia/south-korea-latest.osm.pbf` |
| Local raw filename | `south-korea-260617.osm.pbf` |
| User-observed size | `267 MB` |
| SHA256 | `B0CBCD65DC91B979965AFC30256CC3713E37D131DE7D5AA0AD8B947E42D1A74A` |
| Page last modified label | `260617` |
| OSM replication timestamp | `2026-06-17T20:21:14Z` |
| Internal data last timestamp | `2026-06-17T20:19:39Z` |
| Role | Primary OSM source |

### Fallback: OSM Korea non-military

| Field | Value |
|---|---|
| Source ID | `osm_korea_non_military_20260618` |
| Download URL | `https://tiles.osm.kr/download/south-korea-latest-non-military.osm.pbf` |
| Local raw filename | `south-korea-latest-non-military.osm.pbf` |
| User-observed size | `264 MB` |
| SHA256 | `339B3D63E346D3E5C578537F495A629B289EA29A8DA8962EAD4548BF1A3F58D7` |
| Page last modified label | `18-Jun-2026 06:40` |
| Internal data last timestamp | `2026-06-17T20:19:39Z` |
| Role | Fallback OSM source |

Recommended raw placement:

```text
data/raw/2026-06-17/osm/geofabrik/south-korea-260617.osm.pbf
data/raw/2026-06-18/osm/osm-korea/south-korea-latest-non-military.osm.pbf
```

## Verified toolchain

The local verification was performed with Osmium Tool in WSL.

```text
osmium version 1.19.0
libosmium version 2.23.0
Supported PBF compression types: none zlib lz4
```

## Verified fileinfo: primary railway extraction

Generated extraction file:

```text
railway-geofabrik.osm.pbf
```

Observed fileinfo:

| Field | Value |
|---|---|
| Format | PBF |
| Size | `2,257,221 bytes` |
| Header timestamp | `2026-06-17T20:21:14Z` |
| Data bounding box | `(126.3864427,33.3594227,130.7984876,38.6290772)` |
| Data first timestamp | `2008-10-13T01:32:50Z` |
| Data last timestamp | `2026-06-16T11:59:57Z` |
| Nodes | `172,973` |
| Ways | `28,293` |
| Relations | `332` |
| Ordered by type/id | `yes` |
| Metadata | `version+timestamp` |

Generated extraction placement:

```text
data/probe/2026-06-17/osm/geofabrik/railway-geofabrik.osm.pbf
```

## Verified fileinfo: fallback railway extraction

Generated extraction file:

```text
railway-osm-korea.osm.pbf
```

Observed fileinfo:

| Field | Value |
|---|---|
| Format | PBF |
| Size | `2,219,591 bytes` |
| Data bounding box | `(126.3864427,33.3594227,130.7984876,38.6138018)` |
| Data first timestamp | `2008-10-13T01:32:50Z` |
| Data last timestamp | `2026-06-15T11:10:48Z` |
| Nodes | `169,901` |
| Ways | `28,047` |
| Relations | `311` |
| Ordered by type/id | `yes` |
| Metadata | `version+timestamp` |

Generated extraction placement:

```text
data/probe/2026-06-18/osm/osm-korea/railway-osm-korea.osm.pbf
```

## Railway extraction command

For Geofabrik:

```bash
osmium tags-filter south-korea-260617.osm.pbf n/railway w/railway r/railway r/route=train r/route=subway r/route=light_rail -o railway-geofabrik.osm.pbf --overwrite
```

For OSM Korea fallback:

```bash
osmium tags-filter south-korea-latest-non-military.osm.pbf n/railway w/railway r/railway r/route=train r/route=subway r/route=light_rail -o railway-osm-korea.osm.pbf --overwrite
```

## Observed primary tag values

The primary railway extraction contains the following important tag-value counts:

| Tag/value | Count |
|---|---:|
| `railway=*` | `43,269` |
| `railway=rail` | `21,791` |
| `railway=subway` | `2,279` |
| `railway=station` | `1,362` |
| `railway=platform` | `1,321` |
| `railway=light_rail` | `331` |
| `railway=monorail` | `134` |
| `railway=narrow_gauge` | `48` |
| `railway=halt` | `14` |
| `public_transport=station` | `1,370` |
| `public_transport=platform` | `1,304` |
| `public_transport=stop_position` | `2,541` |
| `route=subway` | `181` |
| `route=train` | `106` |
| `route=light_rail` | `22` |
| `name:ko` | `19,583` |
| `name:en` | `19,053` |
| `name:zh` | `15,038` |
| `name:ja` | `13,711` |
| `operator=한국철도공사` | `21,492` |
| `operator=서울교통공사` | `2,146` |
| `highspeed=yes` | `4,949` |
| `gauge=1435` | `22,286` |
| `electrified=contact_line` | `18,082` |
| `usage=main` | `13,330` |
| `service=yard` | `5,908` |
| `tunnel=yes` | `2,994` |
| `bridge=yes` | `5,366` |

## Observed fallback tag values

The fallback extraction is close enough for source fallback use.

| Tag/value | Count |
|---|---:|
| `railway=*` | `42,907` |
| `railway=rail` | `21,591` |
| `railway=subway` | `2,272` |
| `railway=station` | `1,359` |
| `railway=platform` | `1,317` |
| `railway=light_rail` | `331` |
| `railway=monorail` | `132` |
| `public_transport=station` | `1,367` |
| `public_transport=platform` | `1,300` |
| `public_transport=stop_position` | `2,539` |
| `route=subway` | `171` |
| `route=train` | `96` |
| `route=light_rail` | `22` |
| `name:ko` | `19,491` |
| `name:en` | `18,966` |
| `name:zh` | `14,984` |
| `name:ja` | `13,661` |

## Active normalized include rules

The collector may include OSM objects as active normalized railway geometry candidates when the object has one of these tags and no exclusion tag is present:

```text
railway=rail
railway=subway
railway=light_rail
railway=monorail
railway=narrow_gauge
railway=station
railway=halt
railway=stop
railway=platform
public_transport=station
public_transport=stop_position
public_transport=platform
route=train
route=subway
route=light_rail
```

`railway=subway_entrance`, `railway=train_station_entrance`, and entrance-related objects should be preserved as raw/probe candidates but should not be promoted to line geometry.

## Active normalized exclude rules

The collector must exclude an OSM object from active normalized output if any of these tags are present:

```text
railway=construction
railway=proposed
railway=abandoned
railway=disused
railway=razed
railway=dismantled
abandoned:railway=*
disused:railway=*
razed:railway=*
construction:railway=*
proposed:railway=*
station=proposed
station=disused
train=disused
usage=disused
```

Exclusion means `not active normalized output`. It does not mean deleting from raw/probe data.

## Raw preservation

The OSM collector must preserve raw tags. Do not collapse or drop tags such as:

```text
name
name:ko
name:en
name:ja
name:zh
name:zh-Hans
name:zh-Hant
operator
operator:ko
operator:en
operator:short
network
network:ko
network:en
railway
route
usage
service
gauge
electrified
voltage
frequency
maxspeed
tracks
tunnel
bridge
layer
highspeed
```

## Language policy

- Store only names present in OSM tags.
- Use `name:ko`, `name:en`, `name:zh`, `name:ja` when available.
- Preserve `name:zh-Hans`, `name:zh-Hant`, `name:ko-Hani`, and `name:ko-Latn` as raw alternate/source tags.
- Do not auto-translate.

## OSM relation policy

Route relations are useful candidates, but they must not be treated as complete or authoritative. Use them as geometry grouping hints only. Final line grouping and KRIC/OSM matching must remain editable in the local editor.

## License and attribution note

OSM-derived data must be treated as OpenStreetMap-derived data. Public release requires proper OSM attribution and license compliance review. Do not ship OSM-derived generated artifacts without a release checklist covering attribution and share-alike implications.
