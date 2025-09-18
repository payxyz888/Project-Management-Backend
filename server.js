// server.js - Updated with Sequelize ORM
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
require('dotenv').config();

// Import models
const { 
  sequelize, 
  User, 
  Project, 
  ProjectMember, 
  Task, 
  ProjectStatus, 
  testConnection, 
  syncDatabase 
} = require('./models');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Helper function to check project access
const checkProjectAccess = async (userId, projectId, role = 'admin') => {
  const user = await User.findByPk(userId);
  if (user.role === 'admin') return true;

  const membership = await ProjectMember.findOne({
    where: { projectId, userId }
  });

  return membership !== null;
};

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      where: {
        [Op.or]: [{ email }, { username }]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create new user
    const newUser = await User.create({
      username,
      email,
      password,
      role: 'user'
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: newUser.id, username: newUser.username, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: newUser.toJSON()
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.errors.map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find user by username or email with password
    const user = await User.scope('withPassword').findOne({
      where: {
        [Op.or]: [{ username }, { email: username }]
      }
    });

    console.log(user);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isPasswordValid = await user.validatePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Project Routes
app.post('/api/projects', async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { name, description } = req.body;
    
    // Create project
    const project = await Project.create({
      name,
      description,
      created_by: req.user?.id || 1 // Use actual user ID from auth
    }, { transaction });
    
    // Create project member
    await ProjectMember.create({
      project_id: project.id,
      user_id: req.user?.id || 1,
      role: 'owner'
    }, { transaction });
    
    // The trigger will automatically create default statuses,
    // but we can also manually ensure they exist:
    const defaultStatuses = [
      { status_key: 'todo', title: 'To Do', color: '#ef4444', order_index: 0 },
      { status_key: 'in-progress', title: 'In Progress', color: '#f97316', order_index: 1 },
      { status_key: 'completed', title: 'Completed', color: '#22c55e', order_index: 2 }
    ];
    
    for (const statusData of defaultStatuses) {
      await ProjectStatus.findOrCreate({
        where: {
          project_id: project.id,
          status_key: statusData.status_key
        },
        defaults: {
          ...statusData,
          project_id: project.id,
          is_default: true
        },
        transaction
      });
    }
    
    await transaction.commit();
    
    const createdProject = await Project.findByPk(project.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'username', 'email'] },
        { model: ProjectStatus, as: 'statuses', where: { is_active: true } }
      ]
    });
    
    res.status(201).json(createdProject);
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating project:', error);
    res.status(400).json({ message: error.message });
  }
});

app.post('/api/projects', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    // Create project
    const newProject = await Project.create({
      name,
      description,
      createdBy: req.user.id
    });

    // Add creator as project owner
    await ProjectMember.create({
      projectId: newProject.id,
      userId: req.user.id,
      role: 'owner'
    });

    // Fetch project with associations
    const projectWithAssociations = await Project.findByPk(newProject.id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ]
    });

    res.status(201).json(projectWithAssociations);
  } catch (error) {
    console.error('Error creating project:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.errors.map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.get('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);

    // Check access
    const hasAccess = await checkProjectAccess(req.user.id, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const project = await Project.findByPk(projectId, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        },
        {
          model: User,
          as: 'members',
          attributes: ['id', 'username', 'email'],
          through: { attributes: ['role', 'joined_at'] }
        }
      ]
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get project stats
    const stats = await project.getStats();

    res.json({
      ...project.toJSON(),
      stats
    });
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

app.put('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { name, description, status } = req.body;

    // Check if user can edit project
    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check permissions
    if (req.user.role !== 'admin' && project.createdBy !== req.user.id) {
      const membership = await ProjectMember.findOne({
        where: { 
          projectId, 
          userId: req.user.id, 
          role: { [Op.in]: ['owner', 'admin'] } 
        }
      });

      if (!membership) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Update project
    await project.update({ name, description, status });

    // Return updated project with associations
    const updatedProject = await Project.findByPk(projectId, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ]
    });

    res.json(updatedProject);
  } catch (error) {
    console.error('Error updating project:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.errors.map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.delete('/api/projects/:id', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check permissions (only creator or admin can delete)
    if (req.user.role !== 'admin' && project.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete project (cascade will handle related records)
    await project.destroy();

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Task Routes
app.get('/api/projects/:projectId/tasks', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);

    // Check project access
    const hasAccess = await checkProjectAccess(req.user.id, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get tasks using model method
    const tasks = await Task.findByProject(projectId);

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/api/projects/:projectId/tasks', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const { title, description, priority, assignedTo, dueDate } = req.body;

    // Check project access
    const hasAccess = await checkProjectAccess(req.user.id, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create task
    const newTask = await Task.create({
      title,
      description,
      priority: priority || 'medium',
      projectId,
      assignedTo: assignedTo || req.user.id,
      createdBy: req.user.id,
      dueDate: dueDate ? new Date(dueDate) : null
    });

    // Fetch task with associations
    const taskWithAssociations = await Task.findByPk(newTask.id, {
      include: [
        {
          model: User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ]
    });

    res.status(201).json(taskWithAssociations);
  } catch (error) {
    console.error('Error creating task:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.errors.map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { title, description, status, priority, assignedTo, dueDate } = req.body;

    const task = await Task.findByPk(taskId, {
      include: [
        {
          model: Project,
          as: 'project'
        }
      ]
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check project access
    const hasAccess = await checkProjectAccess(req.user.id, task.project.id);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update task
    await task.update({
      title,
      description,
      status,
      priority,
      assignedTo,
      dueDate: dueDate ? new Date(dueDate) : null
    });

    // Return updated task with associations
    const updatedTask = await Task.findByPk(taskId, {
      include: [
        {
          model: User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ]
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({ 
        error: 'Validation error', 
        details: error.errors.map(e => e.message) 
      });
    }
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = await Task.findByPk(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check permissions (only creator or admin can delete)
    if (req.user.role !== 'admin' && task.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await task.destroy();

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Additional Task Routes
app.get('/api/tasks/overdue', authenticateToken, async (req, res) => {
  try {
    const overdueTasks = await Task.findOverdue();
    
    // Filter based on user permissions
    let filteredTasks;
    if (req.user.role === 'admin') {
      filteredTasks = overdueTasks;
    } else {
      // Only show overdue tasks from projects user is member of
      const userProjectIds = await ProjectMember.findAll({
        where: { userId: req.user.id },
        attributes: ['projectId']
      }).then(memberships => memberships.map(m => m.projectId));

      filteredTasks = overdueTasks.filter(task => 
        userProjectIds.includes(task.projectId)
      );
    }

    res.json(filteredTasks);
  } catch (error) {
    console.error('Error fetching overdue tasks:', error);
    res.status(500).json({ error: 'Failed to fetch overdue tasks' });
  }
});

app.get('/api/tasks/my-tasks', authenticateToken, async (req, res) => {
  try {
    const myTasks = await Task.findAll({
      where: { assignedTo: req.user.id },
      include: [
        {
          model: Project,
          as: 'project',
          attributes: ['id', 'name']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ],
      order: [['due_date', 'ASC'], ['priority', 'DESC']]
    });

    res.json(myTasks);
  } catch (error) {
    console.error('Error fetching my tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { title, description, priority, project_id, assigned_to, due_date } = req.body;
    
    // Get the default "todo" status for this project
    const defaultStatus = await ProjectStatus.findOne({
      where: {
        project_id,
        status_key: 'todo',
        is_active: true
      }
    });
    
    // Get the highest position in the default status
    const lastTask = await Task.findOne({
      where: { status_id: defaultStatus?.id },
      order: [['position', 'DESC']]
    });
    
    const newPosition = lastTask ? lastTask.position + 1 : 0;
    
    const task = await Task.create({
      title,
      description,
      status: 'todo',
      status_id: defaultStatus?.id,
      position: newPosition,
      priority,
      project_id,
      assigned_to,
      created_by: req.user?.id || 1, // Use actual user ID from auth
      due_date
    });
    
    const createdTask = await Task.findByPk(task.id, {
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'username', 'email'] },
        { model: User, as: 'creator', attributes: ['id', 'username', 'email'] },
        { model: ProjectStatus, as: 'projectStatus' }
      ]
    });
    
    res.status(201).json(createdTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(400).json({ message: error.message });
  }
});

// Users Route (for task assignment)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'username', 'email', 'role'],
      order: [['username', 'ASC']]
    });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Project Members Routes
app.get('/api/projects/:id/members', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);

    // Check project access
    const hasAccess = await checkProjectAccess(req.user.id, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const members = await ProjectMember.findAll({
      where: { projectId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'email', 'role']
        }
      ],
      order: [['joined_at', 'ASC']]
    });

    res.json(members);
  } catch (error) {
    console.error('Error fetching project members:', error);
    res.status(500).json({ error: 'Failed to fetch project members' });
  }
});

app.post('/api/projects/:id/members', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { userId, role = 'member' } = req.body;

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check permissions (only project owner/admin or system admin)
    if (req.user.role !== 'admin' && project.createdBy !== req.user.id) {
      const membership = await ProjectMember.findOne({
        where: { 
          projectId, 
          userId: req.user.id, 
          role: { [Op.in]: ['owner', 'admin'] } 
        }
      });

      if (!membership) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Add member
    const newMember = await ProjectMember.create({
      projectId,
      userId,
      role
    });

    // Return member with user details
    const memberWithUser = await ProjectMember.findByPk(newMember.id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'email', 'role']
        }
      ]
    });

    res.status(201).json(memberWithUser);
  } catch (error) {
    console.error('Error adding project member:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'User is already a member of this project' });
    }
    res.status(500).json({ error: 'Failed to add project member' });
  }
});

// Dashboard Stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    let projectStats, taskStats;

    if (req.user.role === 'admin') {
      // Admin sees all stats
      const [totalProjects, activeProjects] = await Promise.all([
        Project.count(),
        Project.count({ where: { status: 'active' } })
      ]);

      const [totalTasks, completedTasks, assignedToMe] = await Promise.all([
        Task.count(),
        Task.count({ where: { status: 'completed' } }),
        Task.count({ where: { assignedTo: req.user.id } })
      ]);

      projectStats = { totalProjects, activeProjects };
      taskStats = { totalTasks, completedTasks, assignedToMe };
    } else {
      // Regular user sees only their project stats
      const userProjectIds = await ProjectMember.findAll({
        where: { userId: req.user.id },
        attributes: ['projectId']
      }).then(memberships => memberships.map(m => m.projectId));

      const [totalProjects, activeProjects] = await Promise.all([
        Project.count({ where: { id: { [Op.in]: userProjectIds } } }),
        Project.count({ 
          where: { 
            id: { [Op.in]: userProjectIds },
            status: 'active' 
          } 
        })
      ]);

      const [totalTasks, completedTasks, assignedToMe] = await Promise.all([
        Task.count({ where: { projectId: { [Op.in]: userProjectIds } } }),
        Task.count({ 
          where: { 
            projectId: { [Op.in]: userProjectIds },
            status: 'completed' 
          } 
        }),
        Task.count({ where: { assignedTo: req.user.id } })
      ]);

      projectStats = { totalProjects, activeProjects };
      taskStats = { totalTasks, completedTasks, assignedToMe };
    }

    const stats = {
      totalProjects: projectStats.totalProjects,
      activeProjects: projectStats.activeProjects,
      totalTasks: taskStats.totalTasks,
      completedTasks: taskStats.completedTasks,
      pendingTasks: taskStats.totalTasks - taskStats.completedTasks,
      assignedToMe: taskStats.assignedToMe
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Advanced Analytics Routes
app.get('/api/analytics/project/:id', authenticateToken, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);

    // Check project access
    const hasAccess = await checkProjectAccess(req.user.id, projectId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const project = await Project.findByPk(projectId, {
      include: [
        {
          model: Task,
          as: 'tasks'
        },
        {
          model: User,
          as: 'members',
          through: { attributes: ['role'] }
        }
      ]
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Calculate analytics
    const tasks = project.tasks;
    const analytics = {
      tasksByStatus: {
        todo: tasks.filter(t => t.status === 'todo').length,
        inProgress: tasks.filter(t => t.status === 'in-progress').length,
        completed: tasks.filter(t => t.status === 'completed').length
      },
      tasksByPriority: {
        high: tasks.filter(t => t.priority === 'high').length,
        medium: tasks.filter(t => t.priority === 'medium').length,
        low: tasks.filter(t => t.priority === 'low').length
      },
      overdueTasks: tasks.filter(t => t.isOverdue && t.isOverdue()).length,
      completionRate: tasks.length > 0 ? (tasks.filter(t => t.status === 'completed').length / tasks.length * 100).toFixed(1) : 0,
      memberCount: project.members.length,
      averageTasksPerMember: project.members.length > 0 ? (tasks.length / project.members.length).toFixed(1) : 0
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error fetching project analytics:', error);
    res.status(500).json({ error: 'Failed to fetch project analytics' });
  }
});

app.put('/api/tasks/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status_id, position } = req.body;
    
    const task = await Task.findByPk(id);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }
    
    const oldStatusId = task.status_id;
    const oldPosition = task.position;
    
    // Verify the new status exists and belongs to the same project
    const newStatus = await ProjectStatus.findOne({
      where: { 
        id: status_id, 
        project_id: task.project_id,
        is_active: true 
      }
    });
    
    if (!newStatus) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    
    // Handle position updates
    if (oldStatusId === status_id) {
      // Moving within the same status
      if (oldPosition < position) {
        // Moving down: shift up tasks between old and new position
        await Task.update(
          { position: sequelize.literal('position - 1') },
          { 
            where: { 
              status_id, 
              position: { [Op.gt]: oldPosition, [Op.lte]: position } 
            } 
          }
        );
      } else if (oldPosition > position) {
        // Moving up: shift down tasks between new and old position
        await Task.update(
          { position: sequelize.literal('position + 1') },
          { 
            where: { 
              status_id, 
              position: { [Op.gte]: position, [Op.lt]: oldPosition } 
            } 
          }
        );
      }
    } else {
      // Moving to different status
      
      // Adjust positions in old status (shift up tasks after old position)
      await Task.update(
        { position: sequelize.literal('position - 1') },
        { 
          where: { 
            status_id: oldStatusId, 
            position: { [Op.gt]: oldPosition } 
          } 
        }
      );
      
      // Adjust positions in new status (shift down tasks at and after new position)
      await Task.update(
        { position: sequelize.literal('position + 1') },
        { 
          where: { 
            status_id: status_id, 
            position: { [Op.gte]: position } 
          } 
        }
      );
      
      // Update the task's status enum field as well
      const statusMapping = {
        'todo': 'todo',
        'in-progress': 'in-progress', 
        'completed': 'completed'
      };
      
      const enumStatus = statusMapping[newStatus.status_key] || 'todo';
      
      await task.update({ 
        status_id, 
        position, 
        status: enumStatus 
      });
    }
    
    // Update task position if moving within same status
    if (oldStatusId === status_id) {
      await task.update({ position });
    }
    
    // Return updated task with relationships
    const updatedTask = await Task.findByPk(task.id, {
      include: [
        {
          model: ProjectStatus,
          as: 'projectStatus'
        },
        {
          model: User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }
      ]
    });
    
    res.json(updatedTask);
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/statuses/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const statuses = await ProjectStatus.findAll({
      where: { 
        project_id: projectId,
        is_active: true 
      },
      order: [['order_index', 'ASC']],
      include: [{
        model: Task,
        as: 'tasks',
        where: { project_id: projectId },
        required: false,
        order: [['position', 'ASC']],
        include: [{
          model: User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        }]
      }]
    });
    
    res.json(statuses);
  } catch (error) {
    console.error('Error fetching project statuses:', error);
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/statuses/kanban/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const statuses = await ProjectStatus.findAll({
      where: { 
        project_id: projectId,
        is_active: true 
      },
      order: [['order_index', 'ASC']],
      include: [{
        model: Task,
        as: 'tasks',
        where: { project_id: projectId },
        required: false,
        order: [['position', 'ASC']],
        include: [{
          model: User,
          as: 'assignee',
          attributes: ['id', 'username', 'email']
        }, {
          model: User,
          as: 'creator',
          attributes: ['id', 'username', 'email']
        }]
      }]
    });
    
    res.json(statuses);
  } catch (error) {
    console.error('Error fetching kanban data:', error);
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/statuses', async (req, res) => {
  try {
    const { title, color, project_id, status_key } = req.body;
    
    // Validate required fields
    if (!title || !project_id) {
      return res.status(400).json({ message: 'Title and project_id are required' });
    }
    
    // Get the highest order_index for this project
    const lastStatus = await ProjectStatus.findOne({
      where: { project_id },
      order: [['order_index', 'DESC']]
    });
    
    const newOrderIndex = lastStatus ? lastStatus.order_index + 1 : 0;
    
    // Generate status_key if not provided
    const generatedKey = status_key || title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    const status = await ProjectStatus.create({
      project_id,
      status_key: generatedKey,
      title,
      color: color || '#6b7280',
      order_index: newOrderIndex,
      is_default: false
    });
    
    res.status(201).json(status);
  } catch (error) {
    console.error('Error creating status:', error);
    res.status(400).json({ message: error.message });
  }
});

app.put('/api/statuses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, color } = req.body;
    
    const status = await ProjectStatus.findByPk(id);
    
    if (!status) {
      return res.status(404).json({ message: 'Status not found' });
    }
    
    await status.update({ 
      title: title || status.title, 
      color: color || status.color 
    });
    
    res.json(status);
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(400).json({ message: error.message });
  }
});

app.put('/api/statuses/reorder/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { statusIds } = req.body;
    
    if (!Array.isArray(statusIds)) {
      return res.status(400).json({ message: 'statusIds must be an array' });
    }
    
    // Update order_index for each status
    const updatePromises = statusIds.map((statusId, index) => 
      ProjectStatus.update(
        { order_index: index }, 
        { where: { id: statusId, project_id: projectId } }
      )
    );
    
    await Promise.all(updatePromises);
    
    const updatedStatuses = await ProjectStatus.findAll({
      where: { project_id: projectId, is_active: true },
      order: [['order_index', 'ASC']]
    });
    
    res.json(updatedStatuses);
  } catch (error) {
    console.error('Error reordering statuses:', error);
    res.status(400).json({ message: error.message });
  }
});

app.delete('/api/statuses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const status = await ProjectStatus.findByPk(id);
    
    if (!status) {
      return res.status(404).json({ message: 'Status not found' });
    }
    
    // Check if status has tasks
    const taskCount = await Task.count({ where: { status_id: status.id } });
    
    if (taskCount > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete status with existing tasks. Please move tasks first.' 
      });
    }
    
    // Don't allow deletion of default statuses
    if (status.is_default) {
      return res.status(400).json({ 
        message: 'Cannot delete default status.' 
      });
    }
    
    await status.update({ is_active: false });
    res.json({ message: 'Status deleted successfully' });
  } catch (error) {
    console.error('Error deleting status:', error);
    res.status(500).json({ message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database and start server
const initializeApp = async () => {
  try {
    // Test database connection
    await testConnection();
    
    // Sync database models
    await syncDatabase();
    
    // Create default admin user if it doesn't exist
    const adminExists = await User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
      const admin = await User.create({
        username: 'admin',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin'
      });

      // Create sample project
      const sampleProject = await Project.create({
        name: 'Sample Project',
        description: 'A sample project to get started',
        createdBy: admin.id
      });

      // Add admin as project owner
      await ProjectMember.create({
        projectId: sampleProject.id,
        userId: admin.id,
        role: 'owner'
      });

      // Create sample task
      await Task.create({
        title: 'Setup Project Structure',
        description: 'Create the basic project structure and files',
        status: 'completed',
        priority: 'high',
        projectId: sampleProject.id,
        assignedTo: admin.id,
        createdBy: admin.id,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });

      console.log('Default admin user and sample data created');
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await sequelize.close();
  process.exit(0);
});

// Start the application
initializeApp();