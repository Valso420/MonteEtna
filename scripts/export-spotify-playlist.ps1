param(
    [string]$PlaylistId = "3MKATRzfONdGDAbiQ7nioB",
    [int]$Limit = 100,
    [string]$OutputDir = "data"
)

$ErrorActionPreference = "Stop"

$operationName = "queryPlaylist"
$operationHash = "908a5597b4d0af0489a9ad6a2d41bc3b416ff47c0884016d92bbd6822d0eb6d8"
$playlistUri = "spotify:playlist:$PlaylistId"
$embedUrl = "https://open.spotify.com/embed/playlist/$PlaylistId"
$queryUrl = "https://api-partner.spotify.com/pathfinder/v1/query"
$userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

Add-Type -AssemblyName System.Net.Http
$httpClient = [System.Net.Http.HttpClient]::new()

function Invoke-Utf8Request {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [string]$Body = "",
        [hashtable]$Headers = @{}
    )

    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Uri)
    $request.Headers.UserAgent.ParseAdd($userAgent)
    $request.Headers.Accept.ParseAdd("application/json")

    foreach ($header in $Headers.GetEnumerator()) {
        $request.Headers.TryAddWithoutValidation($header.Key, $header.Value) | Out-Null
    }

    if (-not [string]::IsNullOrEmpty($Body)) {
        $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, "application/json")
    }

    $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
    $response.EnsureSuccessStatusCode() | Out-Null

    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Get-SpotifyAccessToken {
    $response = Invoke-Utf8Request -Uri $embedUrl
    $match = [regex]::Match($response, '"accessToken":"([^"]+)"')

    if (-not $match.Success) {
        throw "Could not find Spotify access token in embed response."
    }

    return $match.Groups[1].Value
}

function Invoke-PlaylistPage {
    param(
        [string]$AccessToken,
        [int]$Offset
    )

    $body = @{
        operationName = $operationName
        variables = @{
            uri = $playlistUri
            limit = $Limit
            offset = $Offset
        }
        extensions = @{
            persistedQuery = @{
                version = 1
                sha256Hash = $operationHash
            }
        }
    } | ConvertTo-Json -Depth 10 -Compress

    $headers = @{
        "Authorization" = "Bearer $AccessToken"
    }

    $response = Invoke-Utf8Request -Uri $queryUrl -Method "POST" -Body $body -Headers $headers
    return $response | ConvertFrom-Json
}

function Get-SpotifyId {
    param([string]$Uri)

    if ([string]::IsNullOrWhiteSpace($Uri)) {
        return ""
    }

    return ($Uri -split ":")[-1]
}

function Get-CoverUrl {
    param($CoverArt)

    if (-not $CoverArt -or -not $CoverArt.sources) {
        return ""
    }

    $source = $CoverArt.sources | Sort-Object -Property width -Descending | Select-Object -First 1
    return $source.url
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$accessToken = Get-SpotifyAccessToken
$offset = 0
$position = 1
$tracks = New-Object System.Collections.Generic.List[object]
$playlist = $null

do {
    $page = Invoke-PlaylistPage -AccessToken $accessToken -Offset $offset
    $playlist = $page.data.playlistV2

    if (-not $playlist -or $playlist.__typename -ne "Playlist") {
        throw "Spotify did not return a playlist response."
    }

    foreach ($item in $playlist.content.items) {
        $track = $item.itemV2.data
        if (-not $track -or $track.__typename -ne "Track") {
            continue
        }

        $artists = @($track.artists.items | ForEach-Object { $_.profile.name })
        $artistUris = @($track.artists.items | ForEach-Object { $_.uri })
        $preview = ""

        if ($track.previews.audioPreviews.items.Count -gt 0) {
            $preview = $track.previews.audioPreviews.items[0].url
        }

        $tracks.Add([pscustomobject]@{
            position = $position
            track_id = Get-SpotifyId $track.uri
            track_name = $track.name
            artists = ($artists -join "; ")
            artist_uris = ($artistUris -join "; ")
            album_name = $track.albumOfTrack.name
            album_id = Get-SpotifyId $track.albumOfTrack.uri
            album_uri = $track.albumOfTrack.uri
            duration_ms = [int64]$track.duration.totalMilliseconds
            duration_min = [math]::Round(([double]$track.duration.totalMilliseconds / 60000), 2)
            playcount = if ($track.playcount) { [int64]$track.playcount } else { $null }
            content_rating = $track.contentRating.label
            playable = [bool]$track.playability.playable
            preview_url = $preview
            cover_url = Get-CoverUrl $track.albumOfTrack.coverArt
            track_uri = $track.uri
            track_url = "https://open.spotify.com/track/$(Get-SpotifyId $track.uri)"
        })

        $position++
    }

    $nextOffset = $playlist.content.pagingInfo.nextOffset
    if ($null -eq $nextOffset) {
        break
    }

    $offset = [int]$nextOffset
    Write-Host "Fetched $($tracks.Count) / $($playlist.content.totalCount) tracks..."
} while ($tracks.Count -lt $playlist.content.totalCount)

$uniqueArtists = $tracks |
    ForEach-Object { $_.artists -split "; " } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Sort-Object -Unique

$artistCounts = @{}
foreach ($track in $tracks) {
    foreach ($artist in ($track.artists -split "; ")) {
        if ([string]::IsNullOrWhiteSpace($artist)) {
            continue
        }

        if (-not $artistCounts.ContainsKey($artist)) {
            $artistCounts[$artist] = 0
        }

        $artistCounts[$artist]++
    }
}

$topArtists = $artistCounts.GetEnumerator() |
    Sort-Object -Property Value -Descending |
    Select-Object -First 20 |
    ForEach-Object {
        [pscustomobject]@{
            artist = $_.Key
            tracks = $_.Value
        }
    }

$duplicates = $tracks |
    Group-Object track_uri |
    Where-Object { $_.Count -gt 1 } |
    ForEach-Object {
        [pscustomobject]@{
            track_uri = $_.Name
            count = $_.Count
            track_name = $_.Group[0].track_name
            artists = $_.Group[0].artists
        }
    }

$topTracksByPlaycount = $tracks |
    Where-Object { $null -ne $_.playcount } |
    Sort-Object -Property playcount -Descending |
    Select-Object -First 20 position, track_name, artists, playcount, track_url

$totalDurationMs = [int64](($tracks | Measure-Object -Property duration_ms -Sum).Sum)
$summary = [pscustomobject]@{
    playlist_id = $PlaylistId
    playlist_name = $playlist.name
    playlist_url = "https://open.spotify.com/playlist/$PlaylistId"
    owner_name = $playlist.ownerV2.data.name
    followers = [int]$playlist.followers
    total_tracks = [int]$playlist.content.totalCount
    exported_tracks = [int]$tracks.Count
    total_duration_ms = $totalDurationMs
    total_duration_hours = [math]::Round($totalDurationMs / 3600000, 1)
    average_duration_min = [math]::Round((($tracks | Measure-Object -Property duration_ms -Average).Average / 60000), 2)
    unique_artists = [int]$uniqueArtists.Count
    unique_albums = [int](($tracks | Select-Object -ExpandProperty album_id | Sort-Object -Unique).Count)
    playable_tracks = [int](($tracks | Where-Object { $_.playable }).Count)
    tracks_with_preview = [int](($tracks | Where-Object { -not [string]::IsNullOrWhiteSpace($_.preview_url) }).Count)
    duplicate_tracks = [int]$duplicates.Count
    top_artists = $topArtists
    top_tracks_by_playcount = $topTracksByPlaycount
    duplicate_details = @($duplicates)
    exported_at = (Get-Date).ToString("s")
}

$tracksPath = Join-Path $OutputDir "spotify-playlist-tracks.csv"
$summaryPath = Join-Path $OutputDir "spotify-playlist-summary.json"

$tracks | Export-Csv -Path $tracksPath -NoTypeInformation -Encoding UTF8
$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryPath -Encoding UTF8

Write-Host "Wrote $tracksPath"
Write-Host "Wrote $summaryPath"
