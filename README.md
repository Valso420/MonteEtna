# Monte Etna

Landing puente entre la playlist de Spotify Monte Etna (https://open.spotify.com/playlist/3MKATRzfONdGDAbiQ7nioB?flow_ctx=cb3a84c3-6202-4851-b671-6ee8dfe1af2b%3A1781863630) y el grupo cerrado de WhatsApp.

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
- CSV historico para analisis interno: `data/spotify-playlist-tracks.csv`.
- Resumen analitico: `data/spotify-playlist-summary.json`.
- Script para obtener refresh token: `scripts/get-spotify-refresh-token.mjs`.
- Script de sync oficial: `scripts/sync-spotify-playlist.mjs`.

## Datos publicos de Spotify

Revisado el 2026-06-19:

- Curador: Mate Ramos.
- Items: 1876.
- Saves: 38.
- Duracion total: 146.8 horas.
- Artistas distintos: 1359.
- Albumes representados: 1649.

La landing consume `data/spotify-playlist-summary.json` en runtime estatico con fallback local. No llama a Spotify desde el navegador y no expone secretos.

## Sync oficial de Spotify

El sync usa la API oficial de Spotify con refresh token:

```powershell
$env:SPOTIFY_CLIENT_ID="..."
$env:SPOTIFY_CLIENT_SECRET="..."
$env:SPOTIFY_REFRESH_TOKEN="..."
$env:SPOTIFY_PLAYLIST_ID="3MKATRzfONdGDAbiQ7nioB"
node scripts/sync-spotify-playlist.mjs
```

Salida:

- `data/spotify-playlist-tracks.json`
- `data/spotify-playlist-summary.json`

Validar salida generada:

```powershell
node scripts/validate-spotify-data.mjs
```

Validaciones incluidas:

- falla si Spotify devuelve 0 tracks.
- falla si `exportedTracks` no coincide con `totalTracks`.
- falla si los tracks quedan sin nombre, sin duracion o sin top/recent data.
- genera JSON valido antes de que GitHub Actions commitee cambios.
- no commitea nada si `data/` no cambio.

## Tareas manuales tuyas

1. Crear una app en Spotify Developer Dashboard.
2. Configurar un Redirect URI temporal para obtener el refresh token, por ejemplo `http://127.0.0.1:8888/callback`.
3. Autorizar la app con la cuenta duena de la playlist. El helper pide scopes `playlist-read-private playlist-read-collaborative user-read-private`.
4. Obtener el refresh token localmente:
   ```powershell
   $env:SPOTIFY_CLIENT_ID="..."
   $env:SPOTIFY_CLIENT_SECRET="..."
   $env:SPOTIFY_REDIRECT_URI="http://127.0.0.1:8888/callback"
   node scripts/get-spotify-refresh-token.mjs
   ```
5. Guardar fuera del repo estos valores:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REFRESH_TOKEN`
   - `SPOTIFY_PLAYLIST_ID`
6. Cargar esos cuatro valores como GitHub Actions Secrets del repo.
7. Ejecutar manualmente el workflow `Sync Spotify playlist` una primera vez desde GitHub Actions.
8. Verificar que Vercel redeploye despues del push automatico del workflow.

Si Spotify devuelve `403 Forbidden` al sincronizar, regenerar el refresh token con el helper actualizado. El endpoint oficial de items solo permite leer playlists donde el usuario autorizado es owner o colaborador.

## Desarrollo

Es una pagina estatica. Abrir `index.html` en el navegador o desplegar el repo como sitio estatico.
No requiere paso de build.
