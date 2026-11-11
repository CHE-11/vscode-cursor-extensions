# Taskbar Zoom

Taskbar Zoom puts workbench zoom controls on the status bar.

Maintained by che-11. The behavior comes from [Zoom Bar](https://github.com/wraith13/zoombar-vscode) by [wraith13](https://github.com/wraith13). This copy drops the `@wraith13/vscel` dependency and the web-extension build.

## Status bar

The default order is font-zoom reset, zoom out, the current percentage, then zoom in. Click the percentage to pick a preset or type one. `-` and `+` step the zoom. The font control runs **Editor Font Zoom Reset**.

`taskbarZoom.uiDisplayOrder` uses `@` for font-zoom reset, `%` for the percentage, `+` for zoom in, and `-` for zoom out.

## Commands

| Command | Id |
| --- | --- |
| Taskbar Zoom: Select Zoom | `taskbar-zoom.selectZoom` |
| Taskbar Zoom: Reset Zoom | `taskbar-zoom.resetZoom` |
| Taskbar Zoom: Zoom In | `taskbar-zoom.zoomIn` |
| Taskbar Zoom: Zoom Out | `taskbar-zoom.zoomOut` |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `taskbarZoom.defaultZoom` | 100 | Percentage used by Reset Zoom |
| `taskbarZoom.zoomUnit` | 10 | Step size |
| `taskbarZoom.zoomUnitType` | multiplicative | `multiplicative` scales the current zoom. `additive` adds the unit to the percentage |
| `taskbarZoom.preview` | true | Apply the highlighted zoom before it is confirmed |
| `taskbarZoom.zoomPreset` | 50–300 | Percentages shown in Select Zoom |
| `taskbarZoom.zoomInLabel` | `+` | Zoom-in label. Codicons such as `$(add)` work |
| `taskbarZoom.zoomOutLabel` | `-` | Zoom-out label |
| `taskbarZoom.fontZoomResetLabel` | `$(text-size)` | Font-zoom reset label |
| `taskbarZoom.uiDisplayOrder` | `@-%+` | Which controls appear, and in what order |
| `taskbarZoom.configurationTarget` | auto | `auto`, `global`, or `workspace` |

`auto` updates a workspace zoom when one is already set, and otherwise updates the user zoom.

## Development

Open this folder and press F5. `pnpm test` compiles and runs the zoom math tests. `pnpm run package` writes `builds/taskbar-zoom-<version>.vsix`.

## License

Boost Software License 1.0 (`LICENSE_1_0.txt`), the license of the original Zoom Bar.
