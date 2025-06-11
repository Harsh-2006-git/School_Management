const express = require("express");
const { Pool } = require("pg"); // Changed from mysql2 to pg
const path = require("path");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Database configuration for Aiven PostgreSQL
const dbConfig = {
  host:
    process.env.DB_HOST ,
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ,
  ssl: {
    rejectUnauthorized: false, // For Aiven cloud, SSL is required
  },
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Database connection pool
const pool = new Pool(dbConfig);

// Initialize database and table
async function initializeDatabase() {
  try {
    console.log("Attempting to connect to PostgreSQL with config:", {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database,
      port: dbConfig.port,
    });

    const client = await pool.connect();
    console.log("✅ Connected to PostgreSQL successfully");

    // Create schools table (PostgreSQL syntax)
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500) NOT NULL,
        latitude FLOAT NOT NULL,
        longitude FLOAT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await client.query(createTableQuery);
    console.log("✅ Schools table created/verified");
    console.log("🎉 Database initialization completed successfully");

    client.release();
  } catch (error) {
    console.error("❌ Database initialization error:", error.message);
    console.log("\n🔧 Troubleshooting steps:");
    console.log("1. Make sure your Aiven PostgreSQL instance is running");
    console.log("2. Check your PostgreSQL credentials");
    console.log("3. Verify SSL connection is properly configured");
    console.log("4. Check if your IP is whitelisted in Aiven console");
  }
}

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

// Validation functions
function validateSchoolData(data) {
  const errors = [];

  if (!data.name || data.name.trim().length === 0) {
    errors.push("School name is required");
  }

  if (!data.address || data.address.trim().length === 0) {
    errors.push("Address is required");
  }

  if (!data.latitude || isNaN(parseFloat(data.latitude))) {
    errors.push("Valid latitude is required");
  } else {
    const lat = parseFloat(data.latitude);
    if (lat < -90 || lat > 90) {
      errors.push("Latitude must be between -90 and 90");
    }
  }

  if (!data.longitude || isNaN(parseFloat(data.longitude))) {
    errors.push("Valid longitude is required");
  } else {
    const lon = parseFloat(data.longitude);
    if (lon < -180 || lon > 180) {
      errors.push("Longitude must be between -180 and 180");
    }
  }

  return errors;
}

// Routes

// Home page - Display form to add school and list schools
app.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM schools ORDER BY created_at DESC"
    );
    res.render("index", {
      schools: result.rows, // PostgreSQL returns rows array
      message: null,
      error: null,
    });
  } catch (error) {
    console.error("Error fetching schools:", error);
    res.render("index", {
      schools: [],
      message: null,
      error: "Error loading schools",
    });
  }
});

// Add School API
app.post("/addSchool", async (req, res) => {
  try {
    const { name, address, latitude, longitude } = req.body;

    // Validate input data
    const validationErrors = validateSchoolData(req.body);

    if (validationErrors.length > 0) {
      if (req.headers["content-type"] === "application/json") {
        return res.status(400).json({
          success: false,
          errors: validationErrors,
        });
      } else {
        const result = await pool.query(
          "SELECT * FROM schools ORDER BY created_at DESC"
        );
        return res.render("index", {
          schools: result.rows,
          message: null,
          error: validationErrors.join(", "),
        });
      }
    }

    // Insert school into database (PostgreSQL syntax with RETURNING)
    const insertQuery =
      "INSERT INTO schools (name, address, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING id";
    const result = await pool.query(insertQuery, [
      name.trim(),
      address.trim(),
      parseFloat(latitude),
      parseFloat(longitude),
    ]);

    if (req.headers["content-type"] === "application/json") {
      res.json({
        success: true,
        message: "School added successfully",
        schoolId: result.rows[0].id,
      });
    } else {
      const schoolsResult = await pool.query(
        "SELECT * FROM schools ORDER BY created_at DESC"
      );
      res.render("index", {
        schools: schoolsResult.rows,
        message: "School added successfully!",
        error: null,
      });
    }
  } catch (error) {
    console.error("Error adding school:", error);

    if (req.headers["content-type"] === "application/json") {
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    } else {
      const result = await pool.query(
        "SELECT * FROM schools ORDER BY created_at DESC"
      );
      res.render("index", {
        schools: result.rows,
        message: null,
        error: "Error adding school. Please try again.",
      });
    }
  }
});

// List Schools API
app.get("/listSchools", async (req, res) => {
  try {
    const { latitude, longitude } = req.query;

    // Validate coordinates if provided
    if (latitude && longitude) {
      const userLat = parseFloat(latitude);
      const userLon = parseFloat(longitude);

      if (isNaN(userLat) || isNaN(userLon)) {
        return res.status(400).json({
          success: false,
          error: "Invalid latitude or longitude",
        });
      }

      if (userLat < -90 || userLat > 90 || userLon < -180 || userLon > 180) {
        return res.status(400).json({
          success: false,
          error:
            "Latitude must be between -90 and 90, longitude between -180 and 180",
        });
      }
    }

    // Fetch all schools
    const result = await pool.query("SELECT * FROM schools");
    const schools = result.rows;

    // If user coordinates provided, calculate distances and sort
    if (latitude && longitude) {
      const userLat = parseFloat(latitude);
      const userLon = parseFloat(longitude);

      // Calculate distance for each school
      const schoolsWithDistance = schools.map((school) => ({
        ...school,
        distance: calculateDistance(
          userLat,
          userLon,
          school.latitude,
          school.longitude
        ),
      }));

      // Sort by distance
      schoolsWithDistance.sort((a, b) => a.distance - b.distance);

      res.json({
        success: true,
        schools: schoolsWithDistance,
        userLocation: { latitude: userLat, longitude: userLon },
      });
    } else {
      // Return schools without distance calculation
      res.json({
        success: true,
        schools: schools,
      });
    }
  } catch (error) {
    console.error("Error listing schools:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Find nearest schools page
app.get("/nearest", (req, res) => {
  res.render("nearest");
});

// API route to get nearest schools (for AJAX)
app.get("/api/nearest", async (req, res) => {
  try {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: "Latitude and longitude are required",
      });
    }

    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);

    if (isNaN(userLat) || isNaN(userLon)) {
      return res.status(400).json({
        success: false,
        error: "Invalid coordinates",
      });
    }

    const result = await pool.query("SELECT * FROM schools");
    const schools = result.rows;

    const schoolsWithDistance = schools.map((school) => ({
      ...school,
      distance: calculateDistance(
        userLat,
        userLon,
        school.latitude,
        school.longitude
      ),
    }));

    schoolsWithDistance.sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      schools: schoolsWithDistance,
    });
  } catch (error) {
    console.error("Error finding nearest schools:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Test database connection route
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT 1 + 1 AS result");
    res.json({
      success: true,
      message: "Database connection successful",
      result: result.rows[0].result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Something went wrong!",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render("404");
});

// Initialize database and start server
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
      console.log("📊 Current database configuration:");
      console.log(`   Host: ${dbConfig.host}`);
      console.log(`   User: ${dbConfig.user}`);
      console.log(`   Database: ${dbConfig.database}`);
      console.log(`   Port: ${dbConfig.port}`);
      console.log(`   SSL: Required`);
      console.log(
        "\n💡 If you see database errors above, please check the troubleshooting steps."
      );
    });
  })
  .catch((error) => {
    console.error("❌ Failed to initialize database:", error.message);

    // Still start the server so user can see the interface
    app.listen(PORT, () => {
      console.log(
        `\n🚀 Server is running on http://localhost:${PORT} (with database issues)`
      );
      console.log(
        "🔧 Please fix the database configuration to use the application properly."
      );
    });
  });

module.exports = app;
