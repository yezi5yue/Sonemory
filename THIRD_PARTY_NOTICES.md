# Third-party notices and dependency policy

Version reviewed: Sonemory 0.2.0

## Current runtime inventory

The current Sonemory MVP has no third-party package-manager runtime dependencies. It uses browser platform APIs, including Web Speech API capabilities supplied by the user's browser or operating system. Those external browser or operating-system services are not distributed as part of this repository and remain subject to their providers' terms and privacy behavior.

Current project-authored assets and data:

| Component | Status | License / rights note |
|---|---|---|
| Application source, tests, styles, SVG icon | Project-authored | `AGPL-3.0-only` public path; separate commercial licensing may be available. |
| Small demonstration vocabulary pack | Project-authored demonstration content | Included under the repository license; not derived from a textbook. |
| User-imported learning material | Not distributed by the project | Rights remain with the user or original rights holder. |
| GNU AGPL v3 license text | Free Software Foundation license document | Included verbatim as permitted by the license text. |
| Individual and Entity CLA documents | Adapted from Project Harmony templates | Licensed separately under CC BY 3.0; provenance is stated in each CLA file. |

## Admission policy for future components

Before adding a library, SDK, model, voice, font, dataset, media file, or generated asset, record:

- exact name, version, source URL, commit or checksum;
- copyright holder and full license identifier or contract;
- whether commercial use, modification, redistribution and sublicensing are allowed;
- whether source, attribution, notice, share-alike or network-source obligations apply;
- whether the component can be distributed under the AGPL community edition;
- whether the Project Owner can also include it in a proprietary commercial build;
- model-weight, training-data, voice, likeness, privacy, geographic and acceptable-use restrictions;
- required notices and where they appear in the product; and
- the reviewer and review date.

## Dual-licensing rule

Do not merge a component into the core merely because it is compatible with the AGPL community edition. For the dual-licensing model to remain complete, the Project Owner also needs sufficient rights to use that component in the intended commercial edition, or the commercial edition must exclude or replace it.

Components marked “non-commercial,” “research only,” “no redistribution,” “platform only,” or with unclear model/data terms must not be added to a commercializable core without a separate written license.

## Content rule

Textbooks, teaching aids, paid-course content, official word lists, student recordings, and identifiable learner data are not ordinary software dependencies. Do not commit them unless the Project Owner has documented redistribution rights, privacy authority, and compatibility with both the public and intended commercial release.
