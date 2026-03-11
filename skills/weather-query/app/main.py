from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import httpx
from typing import Optional
import logging
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Weather Query Skill")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Open-Meteo API endpoint (free, no API key required)
OPENMETEO_GEO_API = "https://geocoding-api.open-meteo.com/v1/search"
OPENMETEO_WEATHER_API = "https://api.open-meteo.com/v1/forecast"


async def get_client_ip(request: Request) -> str:
    """Get client IP address from request"""
    # Check for forwarded headers (common in proxy/load balancer setups)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()

    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip

    return request.client.host if request.client else "127.0.0.1"


async def get_city_by_ip(ip: str) -> Optional[str]:
    """Get city name from IP address using ip-api.com (free, no key needed)"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://ip-api.com/json/{ip}")
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    city = data.get("city", "")
                    country = data.get("country", "")
                    # For Chinese cities, return city name directly
                    if country == "China":
                        return city
                    # For international cities, return format: "City, Country"
                    return f"{city}, {country}" if city else None
    except Exception as e:
        logger.error(f"Error getting city by IP: {e}")
    return None


async def get_city_coordinates(city_name: str) -> Optional[tuple]:
    """Get city coordinates using Open-Meteo Geocoding API (free, no key needed)"""
    try:
        url = OPENMETEO_GEO_API
        params = {
            "name": city_name,
            "count": 1,
            "language": "zh",
            "format": "json"
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                results = data.get("results", [])
                if results and len(results) > 0:
                    lat = results[0].get("latitude")
                    lon = results[0].get("longitude")
                    if lat is not None and lon is not None:
                        logger.info(f"Found coordinates for {city_name}: {lat}, {lon}")
                        return (lat, lon)
    except Exception as e:
        logger.error(f"Error getting city coordinates: {e}")
    return None


def get_weather_condition_code(code: int) -> str:
    """Convert WMO weather code to description"""
    weather_codes = {
        0: "Clear sky",
        1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Foggy", 48: "Depositing rime fog",
        51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
        95: "Thunderstorm", 96: "Thunderstorm with hail"
    }
    return weather_codes.get(code, "Unknown")


def get_wind_direction(degree: float) -> str:
    """Convert wind degree to direction string"""
    directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    index = round(int(degree) / 22.5) % 16
    return directions[index]


async def get_weather_from_openmeteo(city_name: str) -> Optional[dict]:
    """Get weather information using Open-Meteo API (free, no API key needed)"""
    try:
        # Get city coordinates
        coords = await get_city_coordinates(city_name)
        if not coords:
            logger.error(f"Could not find coordinates for city: {city_name}")
            return None

        lat, lon = coords

        # Fetch weather data from Open-Meteo
        url = OPENMETEO_WEATHER_API
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "timezone": "auto",
            "forecast_days": 3
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                current = data.get("current", {})

                # Extract current weather
                weather_code = current.get("weather_code", 0)
                temp = current.get("temperature_2m", 0)
                humidity = current.get("relative_humidity_2m", 0)
                wind_speed = current.get("wind_speed_10m", 0)
                wind_dir = current.get("wind_direction_10m", 0)

                return {
                    "city": city_name,
                    "temperature": float(temp),
                    "condition": get_weather_condition_code(weather_code),
                    "humidity": int(humidity),
                    "windSpeed": float(wind_speed),
                    "windDirection": get_wind_direction(wind_dir),
                }
    except Exception as e:
        logger.error(f"Error getting weather from Open-Meteo: {e}", exc_info=True)
    return None


async def get_weather_forecast(city_name: str, days: int = 3) -> Optional[dict]:
    """Get weather forecast using Open-Meteo API"""
    try:
        # Get city coordinates
        coords = await get_city_coordinates(city_name)
        if not coords:
            return None

        lat, lon = coords

        # Fetch weather data from Open-Meteo
        url = OPENMETEO_WEATHER_API
        params = {
            "latitude": lat,
            "longitude": lon,
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "timezone": "auto",
            "forecast_days": days
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                daily = data.get("daily", {})

                forecast = []
                dates = daily.get("time", [])
                codes = daily.get("weather_code", [])
                max_temps = daily.get("temperature_2m_max", [])
                min_temps = daily.get("temperature_2m_min", [])

                for i in range(min(len(dates), days)):
                    forecast.append({
                        "date": dates[i],
                        "maxTemp": float(max_temps[i]),
                        "minTemp": float(min_temps[i]),
                        "condition": get_weather_condition_code(codes[i])
                    })

                return {
                    "city": city_name,
                    "forecast": forecast
                }
    except Exception as e:
        logger.error(f"Error getting weather forecast from Open-Meteo: {e}", exc_info=True)
    return None


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok"}


@app.get("/")
async def root():
    """Serve index.html"""
    index_path = Path(__file__).parent.parent / "static" / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "Weather Query API - Powered by Open-Meteo (free API)"}


@app.get("/api/weather/current")
async def get_current_weather(request: Request):
    """
    Get current weather based on client IP location
    Automatically detects user's city from IP address
    """
    try:
        # Get client IP
        client_ip = await get_client_ip(request)
        logger.info(f"Client IP: {client_ip}")

        # Get city from IP
        city = await get_city_by_ip(client_ip)
        if not city:
            # Fallback to Beijing if IP location fails
            logger.warning(f"Failed to get city from IP {client_ip}, using Beijing as fallback")
            city = "Beijing"

        logger.info(f"Detected city: {city}")

        # Get weather data using Open-Meteo
        weather = await get_weather_from_openmeteo(city)
        if not weather:
            raise HTTPException(status_code=500, detail="Failed to fetch weather data")

        return weather

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_current_weather: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/weather/by-city")
async def get_weather_by_city(city: str):
    """
    Get current weather for a specific city
    Parameter: city - city name (e.g., Beijing, Shanghai, Guangzhou, Beijing, Shanghai)
    Supports both English and Chinese city names
    """
    try:
        if not city:
            raise HTTPException(status_code=400, detail="City parameter is required")

        logger.info(f"Fetching weather for city: {city}")

        # Get weather data using Open-Meteo
        weather = await get_weather_from_openmeteo(city)
        if not weather:
            raise HTTPException(status_code=404, detail=f"City '{city}' not found or weather data unavailable")

        return weather

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_weather_by_city: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/weather/forecast")
async def get_forecast(city: str, days: int = 3):
    """
    Get weather forecast for a specific city
    Parameters:
    - city: city name (e.g., Beijing, Shanghai, Beijing, Shanghai)
    - days: number of forecast days (1-3, default: 3)
    """
    try:
        if not city:
            raise HTTPException(status_code=400, detail="City parameter is required")

        if days < 1 or days > 3:
            raise HTTPException(status_code=400, detail="Days parameter must be between 1 and 3")

        logger.info(f"Fetching {days}-day forecast for city: {city}")

        # Get forecast data using wttr.in
        forecast = await get_weather_forecast(city, days)
        if not forecast:
            raise HTTPException(status_code=404, detail=f"City '{city}' not found or forecast data unavailable")

        return forecast

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_forecast: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
