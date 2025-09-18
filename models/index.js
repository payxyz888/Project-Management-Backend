// models/index.js
const { Sequelize } = require('sequelize');
require('dotenv').config();

// Initialize Sequelize
const sequelize = new Sequelize(
  process.env.DB_NAME || 'project_management',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
      timestamps: true,
      underscored: false
    }
  }
);

// Import models
const User = require('./User')(sequelize);
const Project = require('./Project')(sequelize);
const ProjectMember = require('./ProjectMember')(sequelize);
const Task = require('./Task')(sequelize);
const ProjectStatus = require('./ProjectStatus')(sequelize, DataTypes);

// Define associations
// User associations
User.hasMany(Project, { 
  foreignKey: 'createdBy', 
  as: 'createdProjects',
  onDelete: 'CASCADE'
});

User.hasMany(Task, { 
  foreignKey: 'assignedTo', 
  as: 'assignedTasks',
  onDelete: 'SET NULL'
});

User.hasMany(Task, { 
  foreignKey: 'createdBy', 
  as: 'createdTasks',
  onDelete: 'CASCADE'
});

User.belongsToMany(Project, { 
  through: ProjectMember,
  foreignKey: 'userId',
  otherKey: 'projectId',
  as: 'projects'
});

// Project associations
Project.belongsTo(User, { 
  foreignKey: 'createdBy', 
  as: 'creator'
});

Project.hasMany(Task, { 
  foreignKey: 'projectId',
  as: 'tasks',
  onDelete: 'CASCADE'
});

Project.belongsToMany(User, { 
  through: ProjectMember,
  foreignKey: 'projectId',
  otherKey: 'userId',
  as: 'members'
});

Project.hasMany(ProjectMember, { 
  foreignKey: 'projectId',
  as: 'memberships',
  onDelete: 'CASCADE'
});

Project.hasMany(ProjectStatus, { 
  foreignKey: 'project_id', 
  as: 'statuses' 
});

// Task associations
Task.belongsTo(Project, { 
  foreignKey: 'projectId', 
  as: 'project'
});

Task.belongsTo(User, { 
  foreignKey: 'assignedTo', 
  as: 'assignee'
});

Task.belongsTo(User, { 
  foreignKey: 'createdBy', 
  as: 'creator'
});

Task.belongsTo(ProjectStatus, { 
  foreignKey: 'status_id', 
  as: 'projectStatus' 
});

// ProjectMember associations
ProjectMember.belongsTo(Project, { 
  foreignKey: 'projectId', 
  as: 'project'
});

ProjectMember.belongsTo(User, { 
  foreignKey: 'userId', 
  as: 'user'
});


// NEW: ProjectStatus associations
ProjectStatus.belongsTo(Project, { 
  foreignKey: 'project_id', 
  as: 'project' 
});

ProjectStatus.hasMany(Task, { 
  foreignKey: 'status_id', 
  as: 'tasks' 
});

// Test connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('MySQL connection has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
};

// Sync database
const syncDatabase = async () => {
  try {
    await sequelize.sync({ alter: false });
    console.log('Database synchronized successfully.');
  } catch (error) {
    console.error('Error synchronizing database:', error);
  }
};

module.exports = {
  sequelize,
  User,
  Project,
  ProjectMember,
  Task,
  ProjectStatus,
  testConnection,
  syncDatabase,
};