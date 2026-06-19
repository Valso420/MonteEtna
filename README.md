# Monte Etna

Landing puente entre la playlist de Spotify Monte Etna (https://open.spotify.com/playlist/3MKATRzfONdGDAbiQ7nioB) y el grupo cerrado de WhatsApp.

URL publica: https://monteetna.vercel.app/

## Proposito

Monte Etna presenta una comunidad electronica curada:

- La playlist es el sonido.
- El grupo es el acceso.

La pagina busca que el visitante siga la playlist, entre al grupo cerrado, o complete ambos pasos dentro del mismo circuito.

## Activos

- Spotify: playlist Monte Etna.
- WhatsApp: grupo cerrado, solo admins, sin spam.
- Imagen local de playlist: `assets/playlist-cover.jpg`.
- Imagen hero: `assets/hero-volcanic-club.jpg`.
- Export completo generado por sync: `data/spotify-playlist-tracks.json`.
- CSV historico de la playlist: `data/spotify-playlist-tracks.csv`.
- Resumen analitico: `data/spotify-playlist-summary.json`.
- Script para obtener refresh token: `scripts/get-spotify-refresh-token.mjs`.
- Script de sincronizacion oficial: `scripts/sync-spotify-playlist.mjs`.

## Datos publicos de Spotify

Revisado el 2026-06-19:

- Curador: Mate Ramos.
- Items: 1876.
- Saves: 38.
- Duracion total: 146.8 horas.
- Artistas distintos: 1359.
- Albumes representados: 1649.

La landing consume `data/spotify-playlist-summary.json` en runtime estatico con fallback local. No llama a Spotify desde el navegador y no expone secretos.

## Sincronizacion de Spotify

La actualizacion de datos corre con GitHub Actions cada 6 horas y tambien puede ejecutarse manualmente desde el workflow `Sync Spotify playlist`.

El workflow requiere estos secrets del repo:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`
- `SPOTIFY_PLAYLIST_ID`

El refresh token se genera localmente con el helper:

```powershell
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
$env:SPOTIFY_REDIRECT_URI="http://127.0.0.1:8888/callback"
node scripts/get-spotify-refresh-token.mjs
```

Para sincronizar y validar datos localmente:

```powershell
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
$env:SPOTIFY_REFRESH_TOKEN="..."
$env:SPOTIFY_PLAYLIST_ID="3MKATRzfONdGDAbiQ7nioB"
node scripts/sync-spotify-playlist.mjs
node scripts/validate-spotify-data.mjs
```

Archivos generados:

- `data/spotify-playlist-tracks.json`
- `data/spotify-playlist-summary.json`

Validaciones incluidas:

- falla si Spotify devuelve 0 tracks.
- falla si `exportedTracks` no coincide con `totalTracks`.
- falla si los tracks quedan sin nombre, sin duracion o sin top/recent data.
- genera JSON valido antes de que GitHub Actions confirme cambios.
- el workflow no genera commits si `data/` no cambio.

Si Spotify devuelve `403 Forbidden` al sincronizar, regenerar el refresh token con el helper actualizado. El endpoint oficial de items solo permite leer playlists donde el usuario autorizado es owner o colaborador.

## Desarrollo

Es una pagina estatica. Abrir `index.html` en el navegador o desplegar el repo como sitio estatico.
No requiere paso de build.
