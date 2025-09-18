// models/ProjectMember.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ProjectMember = sequelize.define('ProjectMember', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id'
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id'
    },
    role: {
      type: DataTypes.ENUM('owner', 'admin', 'member'),
      defaultValue: 'member',
      allowNull: false
    }
  }, {
    tableName: 'project_members',
    timestamps: true,
    createdAt: 'joined_at',
    updatedAt: false,
    indexes: [
      {
        unique: true,
        fields: ['project_id', 'user_id']
      }
    ]
  });

  return ProjectMember;
};