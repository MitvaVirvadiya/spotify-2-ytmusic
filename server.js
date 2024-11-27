require("dotenv").config();
const express = require("express");
const cors = require("cors");
const SpotifyWebApi = require("spotify-web-api-node");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Spotify API client
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

// YouTube API base URL
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

// Helper function to extract playlist ID from URL
function extractPlaylistId(url) {
  const matches = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return matches ? matches[1] : null;
}

// Function to create a YouTube playlist
async function createYouTubePlaylist(apiKey, title, description) {
  const url = `${YOUTUBE_API_BASE_URL}/playlists?part=snippet%2Cstatus&key=${apiKey}`;

  const data = {
    snippet: {
      title,
      description,
    },
    status: {
      privacyStatus: "private", // Set to 'public', 'private', or 'unlisted'
    },
  };

  try {
    const response = await axios.post(url, data);
    return response.data.id; // Return the playlist ID
  } catch (error) {
    console.error(
      "Error creating YouTube playlist:",
      error.response?.data || error.message
    );
    throw new Error("Failed to create YouTube playlist");
  }
}

// Function to add a video to a YouTube playlist
async function addVideoToPlaylist(apiKey, playlistId, videoId) {
  const url = `${YOUTUBE_API_BASE_URL}/playlistItems?part=snippet&key=${apiKey}`;

  const data = {
    snippet: {
      playlistId,
      resourceId: {
        kind: "youtube#video",
        videoId,
      },
    },
  };

  try {
    await axios.post(url, data);
  } catch (error) {
    console.error(
      `Error adding video ${videoId} to playlist:`,
      error.response?.data || error.message
    );
    throw new Error("Failed to add video to playlist");
  }
}

app.post("/transfer", async (req, res) => {
  try {
    const { playlistUrl } = req.body;
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;

    console.log("Received playlist URL:", playlistUrl);

    // Extract playlist ID from URL
    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
      throw new Error("Invalid playlist URL");
    }

    // Get Spotify access token
    const authData = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(authData.body["access_token"]);

    // Get Spotify playlist tracks
    const playlist = await spotifyApi.getPlaylist(playlistId);
    const tracks = playlist.body.tracks.items;

    console.log(`Found ${tracks.length} tracks in Spotify playlist`);

    // Prepare YouTube video IDs array
    const videoIds = [];

    // Search for each track on YouTube
    for (const track of tracks) {
      if (track.track) {
        const searchQuery = `${track.track.name} ${track.track.artists[0].name}`;
        const searchUrl = `${YOUTUBE_API_BASE_URL}/search?part=snippet&type=video&q=${encodeURIComponent(
          searchQuery
        )}&key=${youtubeApiKey}`;
        console.log("searchUrl", searchUrl);

        const searchResults = await axios.get(searchUrl);
        const video = searchResults.data.items[0]; // Take the first result

        if (video) {
          videoIds.push(video.id.videoId);
        } else {
          console.log(`No videos found for "${searchQuery}"`);
        }
      }
    }

    console.log(`Collected ${videoIds.length} video IDs`);

    if (!videoIds.length) {
      throw new Error("No matching videos found on YouTube");
    }

    // Create YouTube playlist
    const ytPlaylistId = await createYouTubePlaylist(
      youtubeApiKey,
      playlist.body.name,
      "Created from Spotify playlist"
    );
    console.log("YouTube playlist created with ID:", ytPlaylistId);

    // Add videos to the playlist
    for (const videoId of videoIds) {
      await addVideoToPlaylist(youtubeApiKey, ytPlaylistId, videoId);
      console.log(`Added video ${videoId} to playlist`);
    }

    const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${ytPlaylistId}`;
    console.log("Final YouTube playlist URL:", youtubePlaylistUrl);

    res.json({
      success: true,
      youtubePlaylistUrl,
    });
  } catch (error) {
    console.error("Error transferring playlist:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
