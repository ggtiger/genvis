# Weather Query Skill

实时天气查询服务，支持根据 IP 地址自动定位城市或手动查询指定城市天气。

## 功能特性

- 自动根据用户 IP 地址检测城市并获取天气
- 支持手动输入城市名称查询天气
- 支持中文城市名称（如：北京、上海、合肥）
- 支持国际城市查询

## 使用说明

### 1. 获取 OpenWeatherMap API Key

1. 访问 https://openweathermap.org/api
2. 注册账号（免费）
3. 在 API keys 页面获取你的 API Key
4. 更新 `.env` 文件中的 `OPENWEATHER_API_KEY`

### 2. 配置环境变量

编辑 `.env` 文件，填入你的 API Key：

```env
OPENWEATHER_API_KEY=your_actual_api_key_here
```

### 3. 安装依赖

```bash
pip install -r requirements.txt
```

### 4. 运行服务

```bash
cd app
python main.py
```

或使用 uvicorn：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## API 端点

### GET /health
健康检查端点

### GET /api/weather/current
根据客户端 IP 自动获取天气（自动检测城市）

响应示例：
```json
{
  "city": "Hefei",
  "temperature": 15.5,
  "condition": "Clear sky",
  "humidity": 65,
  "windDirection": "N",
  "windSpeed": 3.5
}
```

### GET /api/weather/by-city?city=Hefei
查询指定城市的天气

参数：
- city: 城市名称（如：Beijing, Shanghai, Hefei, 合肥, 北京）

## 技术栈

- **框架**: FastAPI
- **天气 API**: OpenWeatherMap
- **地理位置**: ip-api.com（免费，无需 Key）
- **语言**: 支持中文和英文

## 注意事项

- OpenWeatherMap 免费版限制：每分钟 60 次请求
- IP 定位使用 ip-api.com，免费版限制：每分钟 45 次请求
- 请确保 `.env` 文件中的 API Key 有效
- 服务使用 IP 地理位置定位，公网 IP 效果最佳
- 本地开发时如果 IP 检测失败，会默认使用北京

