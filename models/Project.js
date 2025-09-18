// models/Project.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Project = sequelize.define('Project', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        len: [1, 200],
        notEmpty: true
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('active', 'completed', 'on-hold'),
      defaultValue: 'active',
      allowNull: false
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'created_by'
    }
  }, {
    tableName: 'projects',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  // Instance methods
  Project.prototype.getStats = async function() {
    const Task = sequelize.models.Task;
    
    const tasks = await Task.findAll({
      where: { projectId: this.id }
    });

    return {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(task => task.status === 'completed').length,
      inProgressTasks: tasks.filter(task => task.status === 'in-progress').length,
      todoTasks: tasks.filter(task => task.status === 'todo').length
    };
  };

  Project.prototype.addMember = async function(userId, role = 'member') {
    const ProjectMember = sequelize.models.ProjectMember;
    
    return await ProjectMember.create({
      projectId: this.id,
      userId: userId,
      role: role
    });
  };

  Project.prototype.removeMember = async function(userId) {
    const ProjectMember = sequelize.models.ProjectMember;
    
    return await ProjectMember.destroy({
      where: {
        projectId: this.id,
        userId: userId
      }
    });
  };

  Project.prototype.isMember = async function(userId) {
    const ProjectMember = sequelize.models.ProjectMember;
    
    const membership = await ProjectMember.findOne({
      where: {
        projectId: this.id,
        userId: userId
      }
    });

    return membership !== null;
  };

  return Project;
};