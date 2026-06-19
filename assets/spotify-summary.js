(function () {
  var fallbackSummary = {
    playlistName: "Monte Etna",
    totalTracks: 1876,
    exportedTracks: 1876,
    totalHours: 146.8,
    averageDurationMin: 4.69,
    uniqueArtists: 1359,
    uniqueAlbums: 1649,
    topArtists: [
      { name: "Anyma", tracks: 56 },
      { name: "Mathame", tracks: 56 },
      { name: "Massano", tracks: 54 },
      { name: "CamelPhat", tracks: 48 },
      { name: "Solomun", tracks: 47 },
      { name: "ARTBAT", tracks: 46 },
    ],
    recentTracks: [
      {
        name: "Blackout",
        artists: ["TH;EN"],
        addedAt: "2026-06-19T16:33:08.000Z",
        spotifyUrl: "https://open.spotify.com/track/4RWY8DxNRBMxXKOzxGOxC7",
      },
      {
        name: "Dancin - Extended Mix",
        artists: ["DEFLEE", "Alexandr Craft"],
        addedAt: "2026-06-19T13:32:52.000Z",
        spotifyUrl: "https://open.spotify.com/track/5eOZ8s3lC288WGTotdRc0z",
      },
      {
        name: "Baptism",
        artists: ["Crystal Castles"],
        addedAt: "2026-06-16T19:22:48.000Z",
        spotifyUrl: "https://open.spotify.com/track/4GJTbB9FNkGkvf6dxl22qW",
      },
      {
        name: "Circus Freaks",
        artists: ["Adam Beyer"],
        addedAt: "2026-06-13T16:10:39.000Z",
        spotifyUrl: "https://open.spotify.com/track/7Mt3W201jQ0yz2Ij1iBKXO",
      },
      {
        name: "Simulated - Bas Amro Remix",
        artists: ["Marco V", "Bas Amro"],
        addedAt: "2026-06-13T03:17:51.000Z",
        spotifyUrl: "https://open.spotify.com/track/2EWnEY46grQZZ9lzbi5Cq7",
      },
    ],
    lastUpdated: "2026-06-19T19:48:12.570Z",
  };

  function pick(summary, camelKey, snakeKey) {
    if (summary[camelKey] !== undefined) {
      return summary[camelKey];
    }

    return summary[snakeKey];
  }

  function normalizeSummary(summary) {
    var topArtists = pick(summary, "topArtists", "top_artists") || [];

    return {
      playlistName: pick(summary, "playlistName", "playlist_name") || fallbackSummary.playlistName,
      totalTracks: pick(summary, "totalTracks", "total_tracks") || fallbackSummary.totalTracks,
      exportedTracks:
        pick(summary, "exportedTracks", "exported_tracks") || fallbackSummary.exportedTracks,
      totalHours:
        pick(summary, "totalHours", "total_duration_hours") || fallbackSummary.totalHours,
      averageDurationMin:
        pick(summary, "averageDurationMin", "average_duration_min") ||
        fallbackSummary.averageDurationMin,
      uniqueArtists:
        pick(summary, "uniqueArtists", "unique_artists") || fallbackSummary.uniqueArtists,
      uniqueAlbums:
        pick(summary, "uniqueAlbums", "unique_albums") || fallbackSummary.uniqueAlbums,
      topArtists: topArtists.map(function (artist) {
        if (typeof artist === "string") {
          return { name: artist, tracks: null };
        }

        return {
          name: artist.name || artist.artist,
          tracks: artist.tracks || null,
        };
      }),
      recentTracks: pick(summary, "recentTracks", "recent_tracks") || [],
      lastUpdated: pick(summary, "lastUpdated", "exported_at") || fallbackSummary.lastUpdated,
    };
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("es-AR").format(value);
  }

  function formatDate(value) {
    if (!value) {
      return "datos sincronizados";
    }

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "datos sincronizados";
    }

    return "actualizada por ultima vez: " + date.toLocaleDateString("es-AR");
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function renderArtists(artists) {
    var element = document.getElementById("top-artists");
    if (!element || artists.length === 0) {
      return;
    }

    element.textContent = "";

    artists.slice(0, 6).forEach(function (artist) {
      var item = document.createElement("span");
      item.textContent = artist.name;
      element.appendChild(item);
    });
  }

  function renderRecentTracks(tracks) {
    var element = document.getElementById("recent-tracks");
    if (!element) {
      return;
    }

    element.textContent = "";

    if (!tracks || tracks.length === 0) {
      var empty = document.createElement("li");
      empty.textContent = "Disponible despues de la primera sincronizacion oficial.";
      element.appendChild(empty);
      return;
    }

    tracks.slice(0, 5).forEach(function (track) {
      var item = document.createElement("li");
      var artists = Array.isArray(track.artists) ? track.artists.join(", ") : track.artists;
      item.textContent = track.name + (artists ? " - " + artists : "");
      element.appendChild(item);
    });
  }

  function render(summary) {
    var totalTracks = formatNumber(summary.totalTracks);
    var totalHours = summary.totalHours.toLocaleString("es-AR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });
    var topNames = summary.topArtists.slice(0, 3).map(function (artist) {
      return artist.name;
    });

    setText("hero-tracks", totalTracks + " tracks");
    setText("hero-hours", totalHours + " horas de musica electronica");
    setText("playlist-tracks", totalTracks + " tracks");
    setText("playlist-hours", totalHours + " horas");
    setText(
      "radiography-copy",
      "El volumen de tracks, horas y artistas define el sonido de la comunidad.",
    );
    setText("tracks-value", totalTracks);
    setText("hours-value", totalHours + " h");
    setText("artists-value", formatNumber(summary.uniqueArtists));
    setText(
      "sound-identity",
      topNames.length
        ? "Mayor presencia: " + topNames.join(", ") + "."
        : "Identidad sonora derivada del resumen oficial.",
    );
    setText("last-updated", formatDate(summary.lastUpdated));

    renderArtists(summary.topArtists);
    renderRecentTracks(summary.recentTracks);
  }

  fetch("data/spotify-playlist-summary.json", { cache: "no-cache" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("Summary not available");
      }

      return response.json();
    })
    .then(function (summary) {
      render(normalizeSummary(summary));
    })
    .catch(function () {
      render(fallbackSummary);
    });
})();
